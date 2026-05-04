// Shared builder for the admin report PDF + a flat employee summary the
// Zoho push uses for the expense Notes field. Both the API route and the
// Zoho push call into here so the PDF the accountant signs and the
// summary table inside Zoho are guaranteed to match.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tempWorkerEntries, taskPayLineItems } from "@/lib/db/schema";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { listShifts } from "@/lib/db/queries/shifts";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { canonicalEndForSchedule } from "@/lib/payroll/period-boundaries";
import { paySchedules } from "@/lib/db/schema";
import type { AdminReportInput } from "./types";

function tzDayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

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

export type AdminReportArtifacts = {
  pdfBytes: Buffer;
  filename: string;
  /**
   * One line per employee/temp worker, formatted for the Zoho expense Notes
   * field. Already includes the leading header row + trailing total.
   */
  summaryText: string;
  totalRoundedCents: number;
  rowCount: number;
};

/**
 * Build the admin report PDF + Zoho summary text for a period. Throws
 * if the period doesn't exist.
 */
export async function buildAdminReportArtifacts(
  periodId: string,
): Promise<AdminReportArtifacts> {
  const period = await getPeriodById(periodId);
  if (!period) throw new Error(`Period ${periodId} not found`);

  // Resolve the period's pay schedule so we can canonical-extend the
  // end date for weekly periods. Short uploads (Mon-Fri) printed
  // "2026-04-27 to 2026-05-01" on the admin report when the canonical
  // pay week is "2026-04-27 to 2026-05-03" (Mon-Sun). Mirrors the
  // /payroll header + /reports table + Zoho expense reference.
  const periodSchedule = period.payScheduleId
    ? (
        await db
          .select()
          .from(paySchedules)
          .where(eq(paySchedules.id, period.payScheduleId))
      )[0]
    : null;
  const displayEndDate = canonicalEndForSchedule(
    period.startDate,
    period.endDate,
    periodSchedule?.periodKind ?? null,
  );

  const [allEmployees, punches, payRules, company, shifts, tempWorkers, tasks] =
    await Promise.all([
      // Match the publish handler — no status filter. Terminated/inactive
      // employees who got a payslip on this period (mid-period termination)
      // should still appear on the printed admin report so the accountant
      // can sign for what was actually paid. The "no punches no tasks"
      // skip below naturally drops anyone irrelevant.
      listEmployees(),
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

  const tz = company.timezone;
  const buildDayInOut = (
    list: typeof punches,
  ): Map<string, { inTime?: string; outTime?: string }> => {
    const out = new Map<string, { inMs: number; outMs: number }>();
    for (const p of list) {
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
  };

  type SummaryRow = {
    legacyId: string | null;
    displayName: string;
    hours: number;
    grossCents: number;
    roundedCents: number;
  };
  const reportEmployees: AdminReportInput["employees"] = [];
  const summaryRows: SummaryRow[] = [];

  for (const e of allEmployees) {
    if (e.payType === "SALARIED") continue;
    const ePunches = punchesByEmployee.get(e.id) ?? [];
    const eTasks = tasksByEmployee.get(e.id) ?? [];
    if (ePunches.length === 0 && eTasks.length === 0) continue;
    const rates = await listRates(e.id);
    const result = computePay({
      punches: ePunches,
      rateAt: (p) => {
        const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
        const day = tzDayKey(d, tz);
        for (const r of rates) if (r.effectiveFrom <= day) return r.hourlyRateCents;
        return e.hourlyRateCents ?? 0;
      },
      taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
      timezone: tz,
      rules: {
        rounding: payRules.rounding,
        hoursDecimalPlaces: payRules.hoursDecimalPlaces,
      },
    });
    if (result.totalHours <= 0 && result.taskCents <= 0) continue;
    const dayInOut = buildDayInOut(ePunches);
    reportEmployees.push({
      displayName: e.displayName,
      legalName: e.legalName,
      legacyId: e.legacyId,
      shiftName: e.shiftId ? shiftById.get(e.shiftId)?.name ?? null : null,
      hourlyRateCents: e.hourlyRateCents,
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
    });
    summaryRows.push({
      legacyId: e.legacyId,
      displayName: e.displayName,
      hours: result.totalHours,
      grossCents: result.grossCents,
      roundedCents: result.roundedCents,
    });
  }

  for (const tw of tempWorkers) {
    const hours = tw.hours !== null ? Number(tw.hours) : 0;
    reportEmployees.push({
      displayName: tw.workerName,
      legalName: tw.workerName,
      legacyId: null,
      shiftName: "Temp / manual labor",
      hourlyRateCents: hours > 0 ? Math.round(tw.amountCents / hours) : null,
      days: [
        {
          date: period.startDate,
          hours,
          cents: tw.amountCents,
          isOvertime: false,
        },
      ],
      totals: {
        hours,
        regularCents: tw.amountCents,
        overtimeCents: 0,
        taskCents: 0,
        grossCents: tw.amountCents,
        roundedCents: tw.amountCents,
      },
      taskPay: tw.description
        ? [{ description: tw.description, amountCents: tw.amountCents }]
        : [],
    });
    summaryRows.push({
      legacyId: `TEMP_${tw.id.slice(0, 4).toUpperCase()}`,
      displayName: tw.workerName,
      hours,
      grossCents: tw.amountCents,
      roundedCents: tw.amountCents,
    });
  }

  reportEmployees.sort((a, b) => {
    const s = (a.shiftName ?? "Unassigned").localeCompare(
      b.shiftName ?? "Unassigned",
    );
    return s !== 0 ? s : a.displayName.localeCompare(b.displayName);
  });
  summaryRows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const renderer = (await import(
    /* webpackIgnore: true */ "@react-pdf/renderer"
  )) as typeof import("@react-pdf/renderer");
  const ADMIN_REPORT_PATH = "/app/.next/pdf/admin-report.js";
  const adminDoc = (await import(
    /* webpackIgnore: true */ ADMIN_REPORT_PATH
  )) as typeof import("@/lib/pdf/admin-report");

  const input: AdminReportInput = {
    company: {
      name: company.name,
      address: company.address,
      brandColorHex: company.brandColorHex,
      locale: company.locale,
    },
    period: { startDate: period.startDate, endDate: displayEndDate },
    rules: {
      rounding: payRules.rounding,
      hoursDecimalPlaces: payRules.hoursDecimalPlaces,
    },
    employees: reportEmployees,
    generatedAt: new Date().toISOString(),
  };
  const pdfBytes = await renderer.renderToBuffer(
    adminDoc.AdminReport({ data: input }),
  );

  const totalRoundedCents = summaryRows.reduce(
    (s, r) => s + r.roundedCents,
    0,
  );
  const lines: string[] = [];
  lines.push(`Payroll Summary — ${period.startDate} to ${period.endDate}`);
  lines.push(`Person ID | Employee | Hours | Pay | Rounded`);
  for (const r of summaryRows) {
    const id = r.legacyId ?? "—";
    const hrs = r.hours.toFixed(2);
    const gross = (r.grossCents / 100).toFixed(2);
    const rounded = Math.round(r.roundedCents / 100).toString();
    lines.push(`${id} | ${r.displayName} | ${hrs} | $${gross} | $${rounded}`);
  }
  lines.push("");
  lines.push(`TOTAL: $${(totalRoundedCents / 100).toFixed(2)}`);
  const summaryText = lines.join("\n");

  return {
    pdfBytes,
    filename: `admin_report_${period.startDate}.pdf`,
    summaryText,
    totalRoundedCents,
    rowCount: summaryRows.length,
  };
}
