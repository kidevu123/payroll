// Per-schedule "this cycle" summary for the dashboard cockpit.
//
// Each active pay schedule (Weekly / Semi-monthly / Monthly) gets ONE row:
// its current open period, the live total for that period, headcount, and the
// run state so the UI can show the correct next action. Totals are computed
// per period and never summed across schedules — the three cadences cover
// different calendar windows, so a combined number would be meaningless.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees as employeesTable,
  taskPayLineItems,
  tempWorkerEntries,
} from "@/lib/db/schema";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { getCurrentPeriodForSchedule } from "@/lib/db/queries/pay-periods";
import { listPunches } from "@/lib/db/queries/punches";
import { getRunForPeriod } from "@/lib/db/queries/payroll-runs";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
import { listRates } from "@/lib/db/queries/rate-history";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { companyDayIso } from "@/lib/time/company-day";

export type CockpitRow = {
  scheduleId: string;
  scheduleName: string;
  periodKind: string;
  period: { id: string; startDate: string; endDate: string; state: string } | null;
  employeeCount: number;
  hours: number;
  grossCents: number;
  roundedCents: number;
  runId: string | null;
  runState: string | null;
  unresolvedAlerts: number;
};

export async function computeScheduleCockpit(today: string): Promise<CockpitRow[]> {
  const [schedules, payRules, company] = await Promise.all([
    listSchedules(),
    getSetting("payRules"),
    getSetting("company"),
  ]);

  const rows = await Promise.all(
    schedules.map(async (s): Promise<CockpitRow> => {
      const period = await getCurrentPeriodForSchedule({
        today,
        payScheduleId: s.id,
      });
      const base = {
        scheduleId: s.id,
        scheduleName: s.name,
        periodKind: s.periodKind,
      };
      if (!period) {
        return {
          ...base,
          period: null,
          employeeCount: 0,
          hours: 0,
          grossCents: 0,
          roundedCents: 0,
          runId: null,
          runState: null,
          unresolvedAlerts: 0,
        };
      }

      const [emps, punches, tasks, temps, run, alerts] = await Promise.all([
        db
          .select()
          .from(employeesTable)
          .where(
            and(
              eq(employeesTable.payScheduleId, s.id),
              eq(employeesTable.status, "ACTIVE"),
            ),
          ),
        listPunches({ periodId: period.id }),
        db
          .select()
          .from(taskPayLineItems)
          .where(eq(taskPayLineItems.periodId, period.id)),
        db
          .select()
          .from(tempWorkerEntries)
          .where(eq(tempWorkerEntries.periodId, period.id)),
        getRunForPeriod(period.id),
        listAlertsForPeriod(period.id, { unresolvedOnly: true }),
      ]);

      const punchesByE = new Map<string, typeof punches>();
      for (const p of punches) {
        const list = punchesByE.get(p.employeeId) ?? [];
        list.push(p);
        punchesByE.set(p.employeeId, list);
      }
      const tasksByE = new Map<string, typeof tasks>();
      for (const t of tasks) {
        const list = tasksByE.get(t.employeeId) ?? [];
        list.push(t);
        tasksByE.set(t.employeeId, list);
      }

      let hours = 0;
      let grossCents = 0;
      let roundedCents = 0;
      let withWork = 0;

      for (const e of emps) {
        const ePunches = punchesByE.get(e.id) ?? [];
        const eTasks = tasksByE.get(e.id) ?? [];
        if (ePunches.length === 0 && eTasks.length === 0) continue;
        const rates = await listRates(e.id);
        const result = computePay({
          punches: ePunches,
          timezone: company.timezone,
          rateAt: (p) => {
            const day = companyDayIso(
              p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn),
              company.timezone,
            );
            for (const r of rates)
              if (r.effectiveFrom <= day) return r.hourlyRateCents;
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
        hours += result.totalHours;
        grossCents += result.grossCents;
        roundedCents += result.roundedCents;
        withWork++;
      }

      for (const tw of temps) {
        grossCents += tw.amountCents;
        roundedCents += tw.amountCents;
        if (tw.hours !== null) hours += Number(tw.hours);
        withWork++;
      }

      return {
        ...base,
        period: {
          id: period.id,
          startDate: period.startDate,
          endDate: period.endDate,
          state: period.state,
        },
        employeeCount: withWork,
        hours,
        grossCents,
        roundedCents,
        runId: run?.id ?? null,
        runState: run?.state ?? null,
        unresolvedAlerts: alerts.length,
      };
    }),
  );

  return rows;
}
