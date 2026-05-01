// Per-period totals for the payroll-trends chart and the period-comparison
// table. Reads payslips, groups by periodId, joins for date ordering.

import { eq, gte, lte, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { payslips, payPeriods } from "@/lib/db/schema";

export type PeriodTotalRow = {
  periodId: string;
  startDate: string;
  endDate: string;
  hours: number;
  grossCents: number;
  roundedCents: number;
  taskCents: number;
  employeeCount: number;
};

export async function getPeriodTotals(
  fromIso?: string,
  toIso?: string,
): Promise<PeriodTotalRow[]> {
  const rows = await db
    .select({
      periodId: payslips.periodId,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      hoursWorked: payslips.hoursWorked,
      grossPayCents: payslips.grossPayCents,
      roundedPayCents: payslips.roundedPayCents,
      taskPayCents: payslips.taskPayCents,
      employeeId: payslips.employeeId,
    })
    .from(payslips)
    .innerJoin(payPeriods, eq(payslips.periodId, payPeriods.id))
    .where(
      and(
        fromIso ? gte(payPeriods.startDate, fromIso) : undefined,
        toIso ? lte(payPeriods.startDate, toIso) : undefined,
      ),
    );

  const byPeriod = new Map<string, PeriodTotalRow>();
  for (const r of rows) {
    const ent =
      byPeriod.get(r.periodId) ??
      ({
        periodId: r.periodId,
        startDate: r.startDate,
        endDate: r.endDate,
        hours: 0,
        grossCents: 0,
        roundedCents: 0,
        taskCents: 0,
        employeeCount: 0,
      } satisfies PeriodTotalRow);
    ent.hours += Number(r.hoursWorked);
    ent.grossCents += r.grossPayCents;
    ent.roundedCents += r.roundedPayCents;
    ent.taskCents += r.taskPayCents;
    ent.employeeCount += 1;
    byPeriod.set(r.periodId, ent);
  }
  return [...byPeriod.values()].sort((a, b) =>
    a.startDate < b.startDate ? -1 : 1,
  );
}
