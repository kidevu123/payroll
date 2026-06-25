import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import { getEmployee } from "@/lib/db/queries/employees";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { getPayslip } from "@/lib/db/queries/payslips";
import { listShifts } from "@/lib/db/queries/shifts";
import { computePay } from "@/lib/payroll/computePay";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import type { EmployeePayslipBatchInput } from "@/lib/pdf/types";
import { companyDayIso } from "@/lib/time/company-day";

function tzDayKey(d: Date, tz: string): string {
  return companyDayIso(d, tz);
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

function buildDayInOut(
  punches: {
    clockIn: Date | string;
    clockOut: Date | string | null;
    voidedAt?: Date | string | null;
  }[],
  tz: string,
): Map<string, { inTime?: string; outTime?: string }> {
  const out = new Map<string, { inMs: number; outMs: number }>();
  for (const p of punches) {
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

export async function buildEmployeePayslipBatchPdf(
  employeeId: string,
  payslipIds: string[],
): Promise<{ pdfBytes: Buffer; filename: string }> {
  const [employee, company, payRules, shifts] = await Promise.all([
    getEmployee(employeeId),
    getSetting("company"),
    getSetting("payRules"),
    listShifts({ includeArchived: true }),
  ]);
  if (!employee) throw new Error("employee not found");

  const tz = company.timezone;
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const rates = await listRates(employeeId);
  const periods: EmployeePayslipBatchInput["periods"] = [];

  for (const payslipId of payslipIds) {
    const payslip = await getPayslip(payslipId);
    if (!payslip || payslip.employeeId !== employeeId) {
      throw new Error(`payslip not found: ${payslipId}`);
    }
    const period = await getPeriodById(payslip.periodId);
    if (!period) throw new Error(`period not found for payslip ${payslipId}`);

    const [punches, tasks] = await Promise.all([
      listPunches({ employeeId, periodId: period.id, includeVoided: false }),
      db
        .select()
        .from(taskPayLineItems)
        .where(
          and(
            eq(taskPayLineItems.employeeId, employeeId),
            eq(taskPayLineItems.periodId, period.id),
          ),
        ),
    ]);

    const deduped = dedupNearDuplicatePunches(punches);
    const result = computePay({
      punches: deduped,
      rateAt: (p) => {
        const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
        const day = tzDayKey(d, tz);
        for (const r of rates) {
          if (r.effectiveFrom <= day) return r.hourlyRateCents;
        }
        return employee.hourlyRateCents ?? 0;
      },
      taskPay: tasks.map((t) => ({ amountCents: t.amountCents })),
      timezone: tz,
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

    const dayInOut = buildDayInOut(deduped, tz);
    periods.push({
      startDate: period.startDate,
      endDate: period.endDate,
      days: result.byDay
        .filter((d) => d.hours > 0)
        .map((d) => {
          const io = dayInOut.get(d.date);
          return {
            date: d.date,
            hours: d.hours,
            cents: d.cents,
            ...(io?.inTime ? { inTime: io.inTime } : {}),
            ...(io?.outTime ? { outTime: io.outTime } : {}),
          };
        }),
      totals: {
        hours: Number(payslip.hoursWorked),
        grossCents: payslip.grossPayCents,
        roundedCents: payslip.roundedPayCents,
      },
      taskPay: tasks.map((t) => ({
        description: t.description,
        amountCents: t.amountCents,
      })),
    });
  }

  const input: EmployeePayslipBatchInput = {
    company: {
      name: company.name,
      brandColorHex: company.brandColorHex,
      locale: company.locale,
    },
    employee: {
      displayName: employee.displayName,
      legacyId: employee.legacyId ?? employee.ngtecoEmployeeRef ?? null,
      hourlyRateCents: employee.hourlyRateCents,
      shiftName: employee.shiftId
        ? (shiftById.get(employee.shiftId)?.name ?? null)
        : null,
    },
    rules: { hoursDecimalPlaces: payRules.hoursDecimalPlaces },
    periods,
    generatedAt: new Date().toISOString().slice(0, 10),
  };

  const renderer = (await import(
    /* webpackIgnore: true */ "@react-pdf/renderer"
  )) as typeof import("@react-pdf/renderer");
  const BATCH_PATH = "/app/.next/pdf/payslip-batch-sheet.js";
  let mod: typeof import("@/lib/pdf/payslip-batch-sheet");
  try {
    mod = (await import(
      /* webpackIgnore: true */ BATCH_PATH
    )) as typeof import("@/lib/pdf/payslip-batch-sheet");
  } catch {
    mod = await import("@/lib/pdf/payslip-batch-sheet");
  }
  const pdfBytes = await renderer.renderToBuffer(
    mod.PayslipBatchSheet({ data: input }),
  );

  const slug = employee.displayName.replace(/[^\w.-]+/g, "_").slice(0, 40);
  return {
    pdfBytes,
    filename: `payslips_${slug}_${payslipIds.length}.pdf`,
  };
}
