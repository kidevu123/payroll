// Streams a printable admin report PDF — per-employee day breakdown
// (with signature + date lines), followed by a single payroll summary
// table. Owner directive: matches the legacy "Admin Report" format
// they use for handing the printed sheet to employees to sign.
//
// Builds on demand from live data, so legacy-imported, manually-
// uploaded, and cron-driven runs all produce a printable report
// regardless of whether one was cached on disk.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
import type { AdminReportInput } from "@/lib/pdf/types";

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

export async function GET(
  _req: Request,
  context: { params: Promise<{ periodId: string }> },
): Promise<Response> {
  await requireAdmin();
  const { periodId } = await context.params;
  const period = await getPeriodById(periodId);
  if (!period) return new NextResponse("period not found", { status: 404 });

  const bytes = await buildAdminReport(periodId, period.startDate, period.endDate);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="admin-report-${period.startDate}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function buildAdminReport(
  periodId: string,
  startDate: string,
  endDate: string,
): Promise<Buffer> {
  const [allEmployees, punches, payRules, company, shifts, tempWorkers, tasks] =
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

  const reportEmployees: AdminReportInput["employees"] = [];

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
  }

  // Render temp workers as their own pseudo-employee pages so they
  // get a signature line too. Their "day" is a single synthetic row
  // with the period start date + their amount.
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
          date: startDate,
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
  }

  reportEmployees.sort((a, b) => {
    const s = (a.shiftName ?? "Unassigned").localeCompare(
      b.shiftName ?? "Unassigned",
    );
    return s !== 0 ? s : a.displayName.localeCompare(b.displayName);
  });

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
    period: { startDate, endDate },
    rules: {
      rounding: payRules.rounding,
      hoursDecimalPlaces: payRules.hoursDecimalPlaces,
    },
    employees: reportEmployees,
    generatedAt: new Date().toISOString(),
  };
  const buf = await renderer.renderToBuffer(adminDoc.AdminReport({ data: input }));
  return buf;
}
