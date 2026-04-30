// payroll.run.publish — admin-approved → generate all payslip PDFs +
// signature report → transition to PUBLISHED → notify employees + admin.
//
// Runs in one job for the whole period (not per-employee fan-out) so the
// signature report stays consistent with the persisted payslip rows.
//
// fs/path/renderer/PDF docs are dynamically imported inside the function
// body so webpack's edge-runtime bundle of instrumentation.ts doesn't try
// to walk them. Only the Node runtime ever invokes this handler.

import { eq } from "drizzle-orm";
import { logger } from "@/lib/telemetry";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import {
  getRun,
  transitionRun,
} from "@/lib/db/queries/payroll-runs";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { listShifts } from "@/lib/db/queries/shifts";
import {
  upsertPayslip,
  markPublished,
} from "@/lib/db/queries/payslips";
import { adminUserIds, userIdsForEmployees } from "@/lib/db/queries/recipients";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { dispatchInApp } from "@/lib/notifications/in-app";
import type {
  PayslipDocInput,
  SignatureReportInput,
} from "@/lib/pdf/types";

const PAYSLIP_ROOT = process.env.PAYSLIP_STORAGE_DIR ?? "/data/payslips";

export async function handlePayrollRunPublish(data: {
  runId: string;
}): Promise<void> {
  const { runId } = data;
  const run = await getRun(runId);
  if (!run) {
    logger.error({ runId }, "publish: run not found");
    return;
  }
  if (run.state !== "APPROVED") {
    throw new Error(
      `publish: run ${runId} is in state ${run.state}; expected APPROVED`,
    );
  }
  const period = await getPeriodById(run.periodId);
  if (!period) throw new Error(`publish: period ${run.periodId} not found`);

  const { mkdirSync } = await import("fs");
  const { join } = await import("path");
  const { writeFile } = await import("fs/promises");

  const [employees, punches, payRules, company, shifts] = await Promise.all([
    listEmployees(),
    listPunches({ periodId: period.id }),
    getSetting("payRules"),
    getSetting("company"),
    listShifts({ includeArchived: true }),
  ]);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  // Task pay rows for this period in one shot.
  const allTasks = await db
    .select()
    .from(taskPayLineItems)
    .where(eq(taskPayLineItems.periodId, period.id));
  const tasksByEmployee = new Map<string, typeof allTasks>();
  for (const t of allTasks) {
    const list = tasksByEmployee.get(t.employeeId) ?? [];
    list.push(t);
    tasksByEmployee.set(t.employeeId, list);
  }

  // Punches grouped per employee.
  const punchesByEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    const list = punchesByEmployee.get(p.employeeId) ?? [];
    list.push(p);
    punchesByEmployee.set(p.employeeId, list);
  }

  const periodDir = join(PAYSLIP_ROOT, period.startDate);
  try {
    mkdirSync(periodDir, { recursive: true });
  } catch (err) {
    logger.warn({ err, periodDir }, "publish: mkdir failed (best effort)");
  }

  // Lazy-load the renderer + the PDF documents at runtime so webpack's
  // edge-runtime bundle of instrumentation.ts doesn't try to compile them.
  const renderer = (await import(
    /* webpackIgnore: true */ "@react-pdf/renderer"
  )) as typeof import("@react-pdf/renderer");
  const payslipDoc = (await import(
    /* webpackIgnore: true */ "../../pdf/payslip.js"
  )) as typeof import("@/lib/pdf/payslip");
  const signatureDoc = (await import(
    /* webpackIgnore: true */ "../../pdf/signature-report.js"
  )) as typeof import("@/lib/pdf/signature-report");

  const sigRows: SignatureReportInput["rows"] = [];

  for (const e of employees) {
    if (e.status !== "ACTIVE" && e.status !== "INACTIVE") continue;
    const ePunches = punchesByEmployee.get(e.id) ?? [];
    const eTasks = tasksByEmployee.get(e.id) ?? [];
    const rates = await listRates(e.id);
    const result = computePay({
      punches: ePunches,
      rateAt: (p) => {
        const dayKey = (p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn))
          .toISOString()
          .slice(0, 10);
        for (const r of rates) {
          if (r.effectiveFrom <= dayKey) return r.hourlyRateCents;
        }
        return e.hourlyRateCents ?? 0;
      },
      taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
      rules: {
        rounding: payRules.rounding,
        hoursDecimalPlaces: payRules.hoursDecimalPlaces,
        ...(payRules.overtime.enabled
          ? {
              overtime: {
                thresholdHours: payRules.overtime.thresholdHours,
                multiplier: payRules.overtime.multiplier,
              },
            }
          : {}),
      },
    });

    const pdfPath = join(periodDir, `${e.id}.pdf`);
    const docInput: PayslipDocInput = {
      company: {
        name: company.name,
        address: company.address,
        brandColorHex: company.brandColorHex,
        locale: company.locale,
      },
      employee: {
        displayName: e.displayName,
        legalName: e.legalName,
        legacyId: e.legacyId,
        shiftName: e.shiftId ? shiftById.get(e.shiftId)?.name ?? null : null,
      },
      period: { startDate: period.startDate, endDate: period.endDate },
      rules: {
        rounding: payRules.rounding,
        hoursDecimalPlaces: payRules.hoursDecimalPlaces,
      },
      days: result.byDay,
      totals: {
        hours: result.totalHours,
        regularCents: result.regularCents,
        overtimeCents: result.overtimeCents,
        taskCents: result.taskCents,
        grossCents: result.grossCents,
        roundedCents: result.roundedCents,
      },
      taskPay: eTasks.map((t) => ({
        description: t.description,
        amountCents: t.amountCents,
      })),
      generatedAt: new Date().toISOString(),
    };
    const buf = await renderer.renderToBuffer(payslipDoc.PayslipDoc({ data: docInput }));
    await writeFile(pdfPath, buf);

    await upsertPayslip({
      employeeId: e.id,
      periodId: period.id,
      payrollRunId: runId,
      hoursWorked: String(result.totalHours),
      grossPayCents: result.grossCents,
      roundedPayCents: result.roundedCents,
      taskPayCents: result.taskCents,
      pdfPath,
    });

    if (result.totalHours > 0 || result.taskCents > 0) {
      sigRows.push({
        shiftName: e.shiftId ? shiftById.get(e.shiftId)?.name ?? "Unassigned" : "Unassigned",
        employeeName: e.displayName,
        legacyId: e.legacyId,
        hours: result.totalHours,
        roundedCents: result.roundedCents,
      });
    }
  }

  // Signature report.
  const sigInput: SignatureReportInput = {
    company: { name: company.name, brandColorHex: company.brandColorHex },
    period: { startDate: period.startDate, endDate: period.endDate },
    rows: sigRows.sort((a, b) => {
      const s = a.shiftName.localeCompare(b.shiftName);
      return s !== 0 ? s : a.employeeName.localeCompare(b.employeeName);
    }),
    generatedAt: new Date().toISOString(),
  };
  const sigBuf = await renderer.renderToBuffer(
    signatureDoc.SignatureReport({ data: sigInput }),
  );
  await writeFile(join(periodDir, "signature-report.pdf"), sigBuf);

  await markPublished(runId);
  await transitionRun(runId, "PUBLISHED", null, {});

  // Notifications: payroll_run.published → all employees with payslips +
  // admins (confirmation).
  const employeesWithPayslips = sigRows.length > 0 ? employees.filter((e) =>
    sigRows.some((r) => r.employeeName === e.displayName),
  ) : [];
  const empToUser = await userIdsForEmployees(employeesWithPayslips.map((e) => e.id));
  const employeeNotices = employeesWithPayslips
    .map((e) => {
      const recipientId = empToUser.get(e.id);
      if (!recipientId) return null;
      return {
        recipientId,
        kind: "payroll_run.published" as const,
        payload: { periodId: period.id, runId },
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);
  if (employeeNotices.length > 0) await dispatchInApp(employeeNotices);
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatchInApp(
      admins.map((id) => ({
        recipientId: id,
        kind: "payroll_run.published",
        payload: { runId, periodId: period.id, count: sigRows.length },
      })),
    );
  }

  logger.info(
    { runId, payslips: sigRows.length, periodDir },
    "publish: -> PUBLISHED",
  );
}
