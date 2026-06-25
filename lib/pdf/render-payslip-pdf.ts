// Render and persist a single employee payslip PDF. Shared by the publish
// job, recompute, and one-off repair scripts so pdf_path never goes stale.

import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import { getEmployee } from "@/lib/db/queries/employees";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { getPayslip } from "@/lib/db/queries/payslips";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { listShifts } from "@/lib/db/queries/shifts";
import { computePay, type ComputePayResult } from "@/lib/payroll/computePay";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import type { PayslipDocInput } from "@/lib/pdf/types";
import { companyDayIso } from "@/lib/time/company-day";

export const PAYSLIP_ROOT = process.env.PAYSLIP_STORAGE_DIR ?? "/data/payslips";

export function tzDayKey(d: Date, tz: string): string {
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

export function buildDayInOut(
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

export function buildPayslipDocInput(args: {
  company: Awaited<ReturnType<typeof getSetting<"company">>>;
  employee: NonNullable<Awaited<ReturnType<typeof getEmployee>>>;
  shiftName: string | null;
  period: { startDate: string; endDate: string };
  payRules: Awaited<ReturnType<typeof getSetting<"payRules">>>;
  punches: Parameters<typeof dedupNearDuplicatePunches>[0];
  tasks: { description: string; amountCents: number }[];
  result: ComputePayResult;
}): PayslipDocInput {
  const dayInOut = buildDayInOut(args.punches, args.company.timezone);
  return {
    company: {
      name: args.company.name,
      address: args.company.address,
      brandColorHex: args.company.brandColorHex,
      locale: args.company.locale,
    },
    employee: {
      displayName: args.employee.displayName,
      legalName: args.employee.legalName,
      legacyId: args.employee.legacyId,
      shiftName: args.shiftName,
      hourlyRateCents: args.employee.hourlyRateCents,
    },
    period: {
      startDate: args.period.startDate,
      endDate: args.period.endDate,
    },
    rules: {
      rounding: args.payRules.rounding,
      hoursDecimalPlaces: args.payRules.hoursDecimalPlaces,
    },
    days: args.result.byDay.map((d) => {
      const io = dayInOut.get(d.date);
      return {
        ...d,
        ...(io?.inTime ? { inTime: io.inTime } : {}),
        ...(io?.outTime ? { outTime: io.outTime } : {}),
      };
    }),
    totals: {
      hours: args.result.totalHours,
      regularCents: args.result.regularCents,
      overtimeCents: args.result.overtimeCents,
      taskCents: args.result.taskCents,
      grossCents: args.result.grossCents,
      roundedCents: args.result.roundedCents,
    },
    taskPay: args.tasks.map((t) => ({
      description: t.description,
      amountCents: t.amountCents,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function renderPayslipPdfBuffer(
  docInput: PayslipDocInput,
): Promise<Buffer> {
  const renderer = (await import(
    /* webpackIgnore: true */ "@react-pdf/renderer"
  )) as typeof import("@react-pdf/renderer");
  const PAYSLIP_DOC_PATH = "/app/.next/pdf/payslip.js";
  const payslipDoc = (await import(
    /* webpackIgnore: true */ PAYSLIP_DOC_PATH
  )) as typeof import("@/lib/pdf/payslip");
  return renderer.renderToBuffer(
    payslipDoc.PayslipDoc({ data: docInput }),
  ) as Promise<Buffer>;
}

export async function writePayslipPdfFile(
  periodStartDate: string,
  employeeId: string,
  buffer: Buffer,
): Promise<string> {
  const periodDir = join(PAYSLIP_ROOT, periodStartDate);
  try {
    mkdirSync(periodDir, { recursive: true });
  } catch {
    /* best effort */
  }
  const pdfPath = join(periodDir, `${employeeId}.pdf`);
  await writeFile(pdfPath, buffer);
  return pdfPath;
}

/** Render + write a payslip PDF from an already-computed pay result. */
export async function writePayslipPdfFromCompute(args: {
  employeeId: string;
  periodId: string;
  punches: Parameters<typeof dedupNearDuplicatePunches>[0];
  tasks: { description: string; amountCents: number }[];
  result: ComputePayResult;
}): Promise<string | null> {
  const [employee, period, company, payRules, shifts, rates] = await Promise.all([
    getEmployee(args.employeeId),
    getPeriodById(args.periodId),
    getSetting("company"),
    getSetting("payRules"),
    listShifts({ includeArchived: true }),
    listRates(args.employeeId),
  ]);
  if (!employee || !period) return null;
  if (employee.payType === "SALARIED") return null;

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const shiftName = employee.shiftId
    ? (shiftById.get(employee.shiftId)?.name ?? null)
    : null;

  const docInput = buildPayslipDocInput({
    company,
    employee,
    shiftName,
    period,
    payRules,
    punches: args.punches,
    tasks: args.tasks,
    result: args.result,
  });
  const buf = await renderPayslipPdfBuffer(docInput);
  return writePayslipPdfFile(period.startDate, employee.id, buf);
}

/** Full reload + compute + render for repair scripts. */
export async function regeneratePayslipPdf(payslipId: string): Promise<string | null> {
  const payslip = await getPayslip(payslipId);
  if (!payslip || payslip.voidedAt) return null;

  const [employee, payRules, company] = await Promise.all([
    getEmployee(payslip.employeeId),
    getSetting("payRules"),
    getSetting("company"),
  ]);
  if (!employee || employee.payType === "SALARIED") return null;

  const [allPunches, rates, tasks] = await Promise.all([
    listPunches({
      employeeId: payslip.employeeId,
      periodId: payslip.periodId,
    }),
    listRates(payslip.employeeId),
    db
      .select()
      .from(taskPayLineItems)
      .where(
        and(
          eq(taskPayLineItems.employeeId, payslip.employeeId),
          eq(taskPayLineItems.periodId, payslip.periodId),
        ),
      ),
  ]);
  const punches = dedupNearDuplicatePunches(allPunches);
  const result = computePay({
    punches,
    rateAt: (p) => {
      const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
      const day = tzDayKey(d, company.timezone);
      for (const r of rates) {
        if (r.effectiveFrom <= day) return r.hourlyRateCents;
      }
      return employee.hourlyRateCents ?? 0;
    },
    taskPay: tasks.map((t) => ({ amountCents: t.amountCents })),
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

  return writePayslipPdfFromCompute({
    employeeId: payslip.employeeId,
    periodId: payslip.periodId,
    punches,
    tasks,
    result,
  });
}
