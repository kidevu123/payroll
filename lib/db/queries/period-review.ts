// Everything the pay-period detail page shows, loaded and shaped in one place:
// the period, who is on it, their punches and computed pay, the stored
// payslips, totals, documents and the cash breakdown. Moved verbatim out of
// app/(admin)/payroll/[periodId]/page.tsx; the rules it applies are the pure
// functions in lib/payroll/period-rows.ts (unit-tested there).
import type React from "react";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { canonicalEndForScheduleName } from "@/lib/payroll/period-boundaries";
import { listRates } from "@/lib/db/queries/rate-history";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { db } from "@/lib/db";
import { taskPayLineItems, payrollRuns, paySchedules } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { listTempWorkers } from "@/lib/db/queries/temp-workers";
import { listDocs, listUnattachedDocsForRange } from "@/lib/db/queries/payroll-documents";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import { findDuplicatePunchClusters } from "@/lib/db/queries/punches";
import { buildDuplicatePunchDetails } from "@/lib/punches/duplicate-details";
import {
  buildCashDenominationSummary,
  buildPayrollCashInputs,
} from "@/lib/payroll/cash-denominations";
import { shouldUseStoredPayrollTotals } from "@/lib/payroll/total-source";
import {
  buildDisplayRows,
  filterPeriodEmployees,
  groupPeriodPunches,
  sumLiveTotals,
  sumStoredPayslips,
} from "@/lib/payroll/period-rows";

export async function loadPeriodReview(periodId: string) {
  const period = await getPeriodById(periodId);
  if (!period) return null;

  const [allEmployees, punches, payRules, payPeriod, company, schedules, tempWorkers, attachedDocs, rangeDocs, allPayslips, duplicateClusters] = await Promise.all([
    listEmployees(),
    listPunches({ periodId }),
    getSetting("payRules"),
    getSetting("payPeriod"),
    getSetting("company"),
    db.select().from(paySchedules),
    listTempWorkers({ periodId }),
    listDocs({ periodId }),
    // Salaried-tab uploads carry the same date range but no period link —
    // show them here too so the period page sees every paystub it covers.
    listUnattachedDocsForRange(period.startDate, period.endDate),
    listPayslipsForPeriod(periodId, { includeVoided: true }),
    findDuplicatePunchClusters({ periodId }),
  ]);
  const payrollDocs = [...attachedDocs, ...rangeDocs];
  const tz = company.timezone ?? "America/New_York";
  const duplicateDetails = buildDuplicatePunchDetails({
    timezone: tz,
    employees: allEmployees.map((employee) => ({
      id: employee.id,
      displayName: employee.displayName,
    })),
    clusters: duplicateClusters,
  });

  // Most recent run for this period (the one that drives the publish-pill).
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.periodId, periodId))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);
  const runScheduleId = run?.payScheduleId ?? null;
  // Resolve the schedule label using BOTH sources — the period's stored
  // pay_schedule_id is the source of truth; fall back to the most-recent
  // run's schedule_id if the period itself wasn't tagged. Driving the
  // pill and the AssignScheduleButton from the same value keeps them
  // honest: pill says UNASSIGNED iff the button is offered.
  const headerScheduleId = period.payScheduleId ?? runScheduleId;
  const headerSchedule = headerScheduleId
    ? schedules.find((s) => s.id === headerScheduleId) ?? null
    : null;
  const runSchedule = runScheduleId
    ? schedules.find((s) => s.id === runScheduleId)
    : null;

  // Filter employees with the same precedence the publish handler uses:
  //   1. run.cohortEmployeeIds (admin-locked cohort) — strongest signal
  //   2. run.payScheduleId OR period.payScheduleId (auto-cohort, treats
  //      NULL-schedule employees as wildcards matching any schedule)
  //   3. all
  // SALARIED staff are excluded from punch-driven views regardless.
  const effectiveScheduleId = runScheduleId ?? period.payScheduleId ?? null;
  const runCohort: string[] | null = Array.isArray(run?.cohortEmployeeIds)
    ? (run!.cohortEmployeeIds as string[])
    : null;
  // Who belongs on this period (cohort > schedule > everyone; never salaried):
  // lib/payroll/period-rows.ts filterPeriodEmployees.
  const employees = filterPeriodEmployees(allEmployees, {
    cohort: runCohort,
    scheduleId: effectiveScheduleId,
  });

  // Display + computePay both consume the deduped list so the period detail
  // and the payslip stay consistent.
  const punchesByEmployee = groupPeriodPunches(
    punches,
    employees.map((e) => e.id),
    !!runScheduleId,
  );

  const tasks = await db
    .select()
    .from(taskPayLineItems)
    .where(eq(taskPayLineItems.periodId, periodId));
  const tasksByEmployee = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByEmployee.get(t.employeeId) ?? [];
    list.push(t);
    tasksByEmployee.set(t.employeeId, list);
  }

  const rows = await Promise.all(
    employees.map(async (e) => {
      const ePunches = punchesByEmployee.get(e.id) ?? [];
      const eTasks = tasksByEmployee.get(e.id) ?? [];
      if (ePunches.length === 0 && eTasks.length === 0) return null;
      const rates = await listRates(e.id);
      const result = computePay({
        punches: ePunches,
        rateAt: (p) => {
          // Same fix as the publish handler — resolve the punch day in
          // company tz, not UTC, so a late-evening ET punch can't grab a
          // next-day rate change.
          const day = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
          }).format(p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn));
          for (const r of rates) {
            if (r.effectiveFrom <= day) return r.hourlyRateCents;
          }
          return e.hourlyRateCents ?? 0;
        },
        taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
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
      const incomplete = ePunches.filter((p) => !p.voidedAt && !p.clockOut).length;
      return { employee: e, result, incomplete, punches: ePunches };
    }),
  );
  const rendered = rows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.employee.displayName.localeCompare(b.employee.displayName));

  // For PAID/PUBLISHED periods (especially LEGACY_IMPORT), the stored
  // payslips are the canonical "what was actually paid" — live computePay
  // can under-report when punch data wasn't fully imported. Sum the
  // non-voided payslips and use that as the period total instead.
  const { sum: payslipSum, hours: payslipHours } = sumStoredPayslips(allPayslips);
  const liveTotals = sumLiveTotals(rendered);

  // Use stored payslip data when it's authoritative: PAID periods,
  // employee-visible published periods, legacy imports, or periods where
  // live punches are missing. Otherwise prefer live computePay results so
  // the admin sees the latest from current punches before publishing.
  const useStoredTotals = shouldUseStoredPayrollTotals({
    periodState: period.state,
    runSource: run?.source ?? null,
    publishedToPortalAt: run?.publishedToPortalAt ?? null,
    payslipSumCents: payslipSum,
    liveRoundedCents: liveTotals.rounded,
  });

  // Map employee_id -> active payslip for quick row override.
  const payslipByEmployee = new Map(
    allPayslips.filter((p) => !p.voidedAt).map((p) => [p.employeeId, p]),
  );

  // Stored: rows come from the payslips (with drift detection). Live: the
  // computed rows as they are. lib/payroll/period-rows.ts buildDisplayRows.
  const displayRows = buildDisplayRows({
    rendered,
    payslips: allPayslips,
    allEmployees,
    useStored: useStoredTotals,
  });

  const totals = useStoredTotals
    ? { hours: payslipHours, gross: payslipSum, rounded: payslipSum }
    : liveTotals;

  // Temp/manual labor sum — added to the period grand total in the header
  // so the displayed amount matches what /reports shows for the period
  // (which always includes temp via tempLaborCents).
  const tempWorkersTotalCents = tempWorkers.reduce(
    (acc, e) => acc + e.amountCents,
    0,
  );
  const periodGrandTotalCents = totals.rounded + tempWorkersTotalCents;
  const cashSource = buildPayrollCashInputs({
    payslips: useStoredTotals ? allPayslips : [],
    employees: allEmployees,
    computedRows: displayRows,
    tempWorkers,
  });
  const cashSummary = buildCashDenominationSummary(cashSource);
  const periodLabel = `${period.startDate} – ${canonicalEndForScheduleName(
    period.startDate,
    period.endDate,
    runSchedule?.name ?? null,
  )}`;

  return {
    period,
    allEmployees,
    punches,
    payRules,
    schedules,
    tempWorkers,
    allPayslips,
    payrollDocs,
    tz,
    duplicateDetails,
    run,
    headerScheduleId,
    headerSchedule,
    runSchedule,
    employees,
    rows,
    rendered,
    payslipByEmployee,
    displayRows,
    totals,
    tempWorkersTotalCents,
    periodGrandTotalCents,
    cashSummary,
    periodLabel,
  };
}

/** The loaded period, as the detail page's sections receive it. */
export type PeriodReview = NonNullable<Awaited<ReturnType<typeof loadPeriodReview>>>;
