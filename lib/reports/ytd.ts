// Year-to-date totals per employee. Reads from persisted Payslip rows
// (only PUBLISHED runs land here) and groups by employeeId.

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { payslips, payPeriods } from "@/lib/db/schema";

export type YtdRow = {
  employeeId: string;
  hours: number;
  grossCents: number;
  roundedCents: number;
  taskCents: number;
  payslipCount: number;
};

/**
 * Sum payslips whose period start falls in the calendar year.
 */
export async function getYtd(year: number): Promise<YtdRow[]> {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const rows = await db
    .select({
      employeeId: payslips.employeeId,
      hoursWorked: payslips.hoursWorked,
      grossPayCents: payslips.grossPayCents,
      roundedPayCents: payslips.roundedPayCents,
      taskPayCents: payslips.taskPayCents,
    })
    .from(payslips)
    .innerJoin(payPeriods, eq(payslips.periodId, payPeriods.id))
    .where(and(gte(payPeriods.startDate, start), lte(payPeriods.startDate, end)));

  const byEmp = new Map<string, YtdRow>();
  for (const r of rows) {
    const ent = byEmp.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      hours: 0,
      grossCents: 0,
      roundedCents: 0,
      taskCents: 0,
      payslipCount: 0,
    };
    ent.hours += Number(r.hoursWorked);
    ent.grossCents += r.grossPayCents;
    ent.roundedCents += r.roundedPayCents;
    ent.taskCents += r.taskPayCents;
    ent.payslipCount += 1;
    byEmp.set(r.employeeId, ent);
  }
  return [...byEmp.values()].sort((a, b) => b.roundedCents - a.roundedCents);
}
