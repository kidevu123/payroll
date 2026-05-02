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
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { listRates } from "@/lib/db/queries/rate-history";
import { listShifts } from "@/lib/db/queries/shifts";
import {
  upsertPayslip,
  markPublished,
} from "@/lib/db/queries/payslips";
import { adminUserIds, userIdsForEmployees } from "@/lib/db/queries/recipients";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { dispatch } from "@/lib/notifications/router";
import type {
  PayslipDocInput,
  SignatureReportInput,
} from "@/lib/pdf/types";

const PAYSLIP_ROOT = process.env.PAYSLIP_STORAGE_DIR ?? "/data/payslips";

/**
 * Format a Date as a YYYY-MM-DD calendar day in the supplied timezone.
 * Mirrors the bucket key computePay uses (it pre-shifts before passing to
 * dayKey), so the maps stay aligned.
 */
function tzDayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/** Format a Date as HH:MM:SS in the supplied timezone (24h). */
function tzTimeOfDay(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  let h = "00";
  let m = "00";
  let s = "00";
  for (const p of parts) {
    if (p.type === "hour") h = p.value === "24" ? "00" : p.value;
    else if (p.type === "minute") m = p.value;
    else if (p.type === "second") s = p.value;
  }
  return `${h}:${m}:${s}`;
}

/**
 * For each day a punch contributes hours to, find the earliest clockIn and
 * the latest clockOut (formatted in company timezone). Voided + incomplete
 * punches are skipped — they don't contribute pay either.
 */
function buildDayInOut(
  ePunches: { clockIn: Date | string; clockOut: Date | string | null; voidedAt?: Date | string | null }[],
  tz: string,
): Map<string, { inTime?: string; outTime?: string }> {
  const out = new Map<string, { inMs: number; outMs: number }>();
  for (const p of ePunches) {
    if (p.voidedAt) continue;
    if (!p.clockOut) continue;
    const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    const outT = p.clockOut instanceof Date ? p.clockOut : new Date(p.clockOut);
    if (Number.isNaN(inT.getTime()) || Number.isNaN(outT.getTime())) continue;
    if (outT.getTime() <= inT.getTime()) continue;
    const day = tzDayKey(inT, tz);
    const cur = out.get(day);
    if (!cur) {
      out.set(day, { inMs: inT.getTime(), outMs: outT.getTime() });
    } else {
      if (inT.getTime() < cur.inMs) cur.inMs = inT.getTime();
      if (outT.getTime() > cur.outMs) cur.outMs = outT.getTime();
    }
  }
  const formatted = new Map<string, { inTime?: string; outTime?: string }>();
  for (const [day, v] of out) {
    formatted.set(day, {
      inTime: tzTimeOfDay(new Date(v.inMs), tz),
      outTime: tzTimeOfDay(new Date(v.outMs), tz),
    });
  }
  return formatted;
}

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

  const { mkdirSync } = await import(/* webpackIgnore: true */ "fs");
  const { join } = await import(/* webpackIgnore: true */ "path");
  const { writeFile } = await import(/* webpackIgnore: true */ "fs/promises");

  // Cohort filter — three layers, in order of precedence:
  //   1. run.cohortEmployeeIds — explicit admin selection from the upload
  //      preview step. This is the strongest signal and overrides everything.
  //   2. run.payScheduleId — auto-cohort by pay schedule.
  //   3. Neither — include everyone (legacy back-compat).
  const employeeFilter = run.payScheduleId
    ? { payScheduleId: run.payScheduleId }
    : {};
  const [allEmployees, punches, payRules, company, shifts] = await Promise.all([
    listEmployees(employeeFilter),
    listPunches({ periodId: period.id }),
    getSetting("payRules"),
    getSetting("company"),
    listShifts({ includeArchived: true }),
  ]);
  const cohort: Set<string> | null = Array.isArray(run.cohortEmployeeIds)
    ? new Set(run.cohortEmployeeIds)
    : null;
  const employees = cohort
    ? allEmployees.filter((e) => cohort.has(e.id))
    : allEmployees;
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

  // Punches grouped per employee — and deduped so payslips don't double-
  // count when realtime poll + CSV import inserted near-identical rows.
  const punchesByEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    const list = punchesByEmployee.get(p.employeeId) ?? [];
    list.push(p);
    punchesByEmployee.set(p.employeeId, list);
  }
  for (const [empId, list] of punchesByEmployee) {
    punchesByEmployee.set(empId, dedupNearDuplicatePunches(list));
  }

  const periodDir = join(PAYSLIP_ROOT, period.startDate);
  try {
    mkdirSync(periodDir, { recursive: true });
  } catch (err) {
    logger.warn({ err, periodDir }, "publish: mkdir failed (best effort)");
  }

  // Lazy-load the renderer + the PDF documents at runtime. Previously
  // these used /* webpackIgnore: true */ to keep @react-pdf out of the
  // edge-runtime bundle, but the relative-path imports broke in
  // production because the bundled chunk lives at /app/.next/server/
  // chunks/<hash>.js — `../../pdf/payslip.js` resolved to the
  // non-existent /app/.next/pdf/payslip.js. Letting webpack bundle
  // them via @/-aliased imports is fine because this handler only
  // runs in the Node runtime (registered in lib/jobs/index.ts via
  // boss.work, never in edge).
  const renderer = (await import(
    /* webpackIgnore: true */ "@react-pdf/renderer"
  )) as typeof import("@react-pdf/renderer");
  const payslipDoc = await import("@/lib/pdf/payslip");
  const signatureDoc = await import("@/lib/pdf/signature-report");

  const sigRows: SignatureReportInput["rows"] = [];

  for (const e of employees) {
    if (e.status !== "ACTIVE" && e.status !== "INACTIVE") continue;
    // SALARIED employees are paid externally (accountant cuts the check).
    // We don't compute hours/pay or generate a payslip; the admin uploads
    // the W2/paystub through PayrollDocsSection on the period page and the
    // employee sees it on /me/pay. Skipping here also keeps SALARIED rows
    // out of the run's totalAmountCents.
    if (e.payType === "SALARIED") continue;
    const ePunches = punchesByEmployee.get(e.id) ?? [];
    const eTasks = tasksByEmployee.get(e.id) ?? [];
    const rates = await listRates(e.id);
    const result = computePay({
      punches: ePunches,
      rateAt: (p) => {
        // Compare in company timezone — toISOString() is UTC, which would
        // give the wrong day for a late-evening ET punch and retroactively
        // apply a same-day rate change.
        const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
        const dayKey = tzDayKey(d, company.timezone);
        for (const r of rates) {
          if (r.effectiveFrom <= dayKey) return r.hourlyRateCents;
        }
        return e.hourlyRateCents ?? 0;
      },
      taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
      timezone: company.timezone,
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
    // Build first-in / last-out maps per day in company timezone — feeds the
    // legacy-format daily table (Date / In / Out / Hours / Pay).
    const dayInOut = buildDayInOut(ePunches, company.timezone);
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
        hourlyRateCents: e.hourlyRateCents,
      },
      period: { startDate: period.startDate, endDate: period.endDate },
      rules: {
        rounding: payRules.rounding,
        hoursDecimalPlaces: payRules.hoursDecimalPlaces,
      },
      days: result.byDay.map((d) => {
        const io = dayInOut.get(d.date);
        return {
          ...d,
          ...(io?.inTime ? { inTime: io.inTime } : {}),
          ...(io?.outTime ? { outTime: io.outTime } : {}),
        };
      }),
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
  if (employeeNotices.length > 0) await dispatch(employeeNotices);
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatch(
      admins.map((id) => ({
        recipientId: id,
        kind: "payroll_run.published" as const,
        payload: { runId, periodId: period.id, count: sigRows.length },
      })),
    );
  }

  logger.info(
    { runId, payslips: sigRows.length, periodDir },
    "publish: -> PUBLISHED",
  );
}
