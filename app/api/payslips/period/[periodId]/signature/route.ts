// Streams the period signature report PDF. Admin-only.
//
// If the file doesn't exist on disk yet (e.g. legacy imports never
// generated one, or a manual run that hasn't been approved), build it
// on demand from the live period data (employees + punches +
// rate-history + temp workers) so the owner can always print a
// signed report regardless of the run's path through the system.

import { NextResponse } from "next/server";
import { join } from "path";
import { eq, isNull, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { db } from "@/lib/db";
import { tempWorkerEntries, taskPayLineItems } from "@/lib/db/schema";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { listShifts } from "@/lib/db/queries/shifts";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import type { SignatureReportInput } from "@/lib/pdf/types";

const PAYSLIP_ROOT = process.env.PAYSLIP_STORAGE_DIR ?? "/data/payslips";

export async function GET(
  _req: Request,
  context: { params: Promise<{ periodId: string }> },
): Promise<Response> {
  await requireAdmin();
  const { periodId } = await context.params;
  const period = await getPeriodById(periodId);
  if (!period) return new NextResponse("period not found", { status: 404 });

  const cachedPath = join(PAYSLIP_ROOT, period.startDate, "signature-report.pdf");
  const { readFile } = await import("fs/promises");
  let bytes: Buffer | null = null;
  try {
    bytes = await readFile(cachedPath);
  } catch {
    // Not on disk — build it on demand.
  }

  if (!bytes) {
    bytes = await buildSignatureReport(periodId, period.startDate, period.endDate);
  }

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="signature-report-${period.startDate}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function buildSignatureReport(
  periodId: string,
  startDate: string,
  endDate: string,
): Promise<Buffer> {
  const [employees, punches, payRules, company, shifts, tempWorkers, tasks] =
    await Promise.all([
      listEmployees({ status: "ACTIVE" }),
      listPunches({ periodId }),
      getSetting("payRules"),
      getSetting("company"),
      listShifts({ includeArchived: true }),
      db
        .select()
        .from(tempWorkerEntries)
        .where(eq(tempWorkerEntries.periodId, periodId)),
      db
        .select()
        .from(taskPayLineItems)
        .where(eq(taskPayLineItems.periodId, periodId)),
    ]);
  void and;
  void isNull;
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const tasksByEmployee = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByEmployee.get(t.employeeId) ?? [];
    list.push(t);
    tasksByEmployee.set(t.employeeId, list);
  }
  const punchesByEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    const list = punchesByEmployee.get(p.employeeId) ?? [];
    list.push(p);
    punchesByEmployee.set(p.employeeId, list);
  }
  for (const [empId, list] of punchesByEmployee) {
    punchesByEmployee.set(empId, dedupNearDuplicatePunches(list));
  }

  const sigRows: SignatureReportInput["rows"] = [];
  for (const e of employees) {
    if (e.payType === "SALARIED") continue;
    const ePunches = punchesByEmployee.get(e.id) ?? [];
    const eTasks = tasksByEmployee.get(e.id) ?? [];
    if (ePunches.length === 0 && eTasks.length === 0) continue;
    const rates = await listRates(e.id);
    const result = computePay({
      punches: ePunches,
      rateAt: (p) => {
        const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: company.timezone,
        }).format(d);
        for (const r of rates) if (r.effectiveFrom <= day) return r.hourlyRateCents;
        return e.hourlyRateCents ?? 0;
      },
      taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
      timezone: company.timezone,
      rules: {
        rounding: payRules.rounding,
        hoursDecimalPlaces: payRules.hoursDecimalPlaces,
      },
    });
    if (result.totalHours <= 0 && result.taskCents <= 0) continue;
    sigRows.push({
      shiftName: e.shiftId ? shiftById.get(e.shiftId)?.name ?? "Unassigned" : "Unassigned",
      employeeName: e.displayName,
      legacyId: e.legacyId,
      hours: result.totalHours,
      roundedCents: result.roundedCents,
    });
  }

  // Render temp workers as their own pseudo-rows so the owner can
  // collect signatures for them too.
  for (const tw of tempWorkers) {
    sigRows.push({
      shiftName: "Temp / manual labor",
      employeeName: tw.workerName,
      legacyId: null,
      hours: tw.hours !== null ? Number(tw.hours) : 0,
      roundedCents: tw.amountCents,
    });
  }

  sigRows.sort((a, b) => {
    const s = a.shiftName.localeCompare(b.shiftName);
    return s !== 0 ? s : a.employeeName.localeCompare(b.employeeName);
  });

  const renderer = (await import(
    /* webpackIgnore: true */ "@react-pdf/renderer"
  )) as typeof import("@react-pdf/renderer");
  const SIG_DOC_PATH = "/app/.next/pdf/signature-report.js";
  const signatureDoc = (await import(
    /* webpackIgnore: true */ SIG_DOC_PATH
  )) as typeof import("@/lib/pdf/signature-report");

  const sigInput: SignatureReportInput = {
    company: { name: company.name, brandColorHex: company.brandColorHex },
    period: { startDate, endDate },
    rows: sigRows,
    generatedAt: new Date().toISOString(),
  };
  const buf = await renderer.renderToBuffer(
    signatureDoc.SignatureReport({ data: sigInput }),
  );
  return buf;
}
