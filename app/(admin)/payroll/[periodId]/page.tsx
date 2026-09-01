// Per-period admin report. v1.2 layout: two sections, one scroll.
//   • Top: employee totals (name | hours | gross | rounded | publish-pill)
//   • Bottom: punches chronologically per employee (in/out/hours per day)
// Reused for both legacy LEGACY_IMPORT runs and live cron-generated runs.

import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
import { notFound } from "next/navigation";
import type React from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  AlertTriangle,
  Printer,
  Scissors,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeriodRange as formatRange } from "@/lib/payroll/format-period";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { SchedulePill } from "@/components/domain/schedule-pill";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { canonicalEndForScheduleName } from "@/lib/payroll/period-boundaries";
import { listRates } from "@/lib/db/queries/rate-history";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { db } from "@/lib/db";
import { taskPayLineItems, payrollRuns, paySchedules } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { LockButtons } from "./lock-buttons";
import { AssignScheduleButton } from "./assign-schedule-button";
import { RecomputeBanner } from "./recompute-banner";
import { PublishPeriodButton } from "./publish-period-button";
import { TempWorkersSection } from "./temp-workers-section";
import { listTempWorkers } from "@/lib/db/queries/temp-workers";
import { PayrollDocsSection } from "./payroll-docs-section";
import { listDocs, listUnattachedDocsForRange } from "@/lib/db/queries/payroll-documents";
import { PayslipManageSection } from "./payslip-manage-section";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import { DedupPunchesButton } from "./dedup-button";
import { findDuplicatePunchClusters } from "@/lib/db/queries/punches";
import { buildDuplicatePunchDetails } from "@/lib/punches/duplicate-details";
import { DisputesPanel } from "./disputes-panel";
import { PeriodDetailBackButton } from "./back-button";
import { CashDenominationButton } from "./cash-denomination-button";
import {
  PayslipPdfActions,
  payslipPdfHref,
} from "@/components/domain/payslip-pdf-actions";
import { backupAdminReportToZohoAction } from "../actions";
import { companyDayIso } from "@/lib/time/company-day";
import { requireSession } from "@/lib/auth-guards";
import {
  buildCashDenominationSummary,
  buildPayrollCashInputs,
} from "@/lib/payroll/cash-denominations";
import { shouldUseStoredPayrollTotals } from "@/lib/payroll/total-source";

function formatHm(d: Date | null, tz: string): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(dt);
}

function formatDayLabel(dateIso: string, tz: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(d);
}

function rateLabel(employee: {
  payType: string;
  hourlyRateCents: number | null;
}): string {
  if (employee.payType === "FLAT_TASK") {
    return `Per task · ${
      employee.hourlyRateCents !== null
        ? `$${(employee.hourlyRateCents / 100).toFixed(2)}`
        : "—"
    }`;
  }
  return employee.hourlyRateCents !== null
    ? `$${(employee.hourlyRateCents / 100).toFixed(2)}/hr`
    : "—";
}

function formatShortDate(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(d instanceof Date ? d : new Date(d));
}

/** Inclusive day count between two ISO dates. */
function periodDayCount(startIso: string, endIso: string): number {
  const a = Date.UTC(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000) + 1;
}

const ROUNDING_LABEL: Record<string, string> = {
  NONE: "Pay is not rounded",
  NEAREST_DOLLAR: "Pay is rounded to the nearest dollar",
  NEAREST_QUARTER: "Pay is rounded to the nearest quarter",
  NEAREST_FIFTEEN_MIN_HOURS: "Hours are rounded to the nearest 15 minutes",
};

function issueLabel(row: {
  incomplete: number;
  hoursDrift?: boolean;
  storedHours?: number;
  liveHours?: number;
}): React.ReactNode {
  if (row.incomplete > 0) {
    return (
      <span className="text-warning-700">
        {row.incomplete} incomplete
      </span>
    );
  }
  if (row.hoursDrift) {
    return (
      <span
        className="inline-flex items-center gap-1 text-warning-700"
        title={`Stored hours (${row.storedHours?.toFixed(2)}h) don't match live punch hours (${row.liveHours?.toFixed(2)}h). Open employee row to inspect; expand to see daily punches. Use "Recompute payslip" on the run page to overwrite stored with live.`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        drift: stored {row.storedHours?.toFixed(2)}h vs live{" "}
        {row.liveHours?.toFixed(2)}h
      </span>
    );
  }
  return <span className="text-text-subtle">—</span>;
}

export default async function PeriodReviewPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const session = await requireSession();
  const isAccountant = session.user.role === "ACCOUNTANT";
  const { periodId } = await params;
  const period = await getPeriodById(periodId);
  if (!period) notFound();

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
  const cohortSet = runCohort ? new Set(runCohort) : null;
  // Strict schedule isolation. Owner has been explicit, repeatedly:
  // weekly and semi-monthly periods must NOT mix employees. The prior
  // OR e.payScheduleId === null was leaking unassigned employees onto
  // every schedule's period.
  //
  //   With cohort     → exact set, no further filter.
  //   With schedule   → exact match. Employees with no schedule still
  //                     appear because they're treated as wildcards
  //                     (legacy onboarding state); future tightening
  //                     would remove this once every employee has a
  //                     schedule attached.
  //   No schedule     → all (legacy fallback for periods that pre-date
  //                     the schedule tagging).
  // SALARIED staff are excluded from the punch-driven totals — they
  // surface in the W2 upload section underneath instead.
  const employees = (
    cohortSet
      ? allEmployees.filter((e) => cohortSet.has(e.id))
      : effectiveScheduleId
        ? allEmployees.filter(
            (e) => e.payScheduleId === effectiveScheduleId,
          )
        : allEmployees
  ).filter((e) => e.payType !== "SALARIED");

  const punchesByEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    if (runScheduleId) {
      const e = employees.find((x) => x.id === p.employeeId);
      if (!e) continue;
    }
    const list = punchesByEmployee.get(p.employeeId) ?? [];
    list.push(p);
    punchesByEmployee.set(p.employeeId, list);
  }
  // Collapse near-duplicates (poll vs CSV producing two rows for the
  // same physical shift). Display + computePay both consume the deduped
  // list so the period detail and the payslip stay consistent.
  for (const [empId, list] of punchesByEmployee) {
    punchesByEmployee.set(empId, dedupNearDuplicatePunches(list));
  }

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
  const payslipSum = allPayslips
    .filter((p) => !p.voidedAt)
    .reduce((s, p) => s + p.roundedPayCents, 0);
  const payslipHours = allPayslips
    .filter((p) => !p.voidedAt)
    .reduce((s, p) => s + Number(p.hoursWorked ?? 0), 0);

  const liveTotals = rendered.reduce(
    (acc, r) => {
      acc.hours += r.result.totalHours;
      acc.gross += r.result.grossCents;
      acc.rounded += r.result.roundedCents;
      return acc;
    },
    { hours: 0, gross: 0, rounded: 0 },
  );

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

  // When useStoredTotals is true, build rows from the payslips themselves
  // (so legacy periods with sparse punch data still show every employee
  // who got paid). For employees not in `rendered`, append synthetic rows
  // sourced from the payslip.
  //
  // Drift detection: legacy-imported payslips sometimes carry stored
  // hours that don't reconcile with the punches in our system (the
  // legacy app may have double-counted, or punch data may not have
  // been imported alongside). Stamp `hoursDriftLive` on the row when
  // stored hours and live punch hours disagree by >0.5h so the table
  // can surface a warning chip and let the admin recompute.
  type RowLike = (typeof rendered)[number] & {
    storedHours?: number;
    liveHours?: number;
    hoursDrift?: boolean;
  };
  const renderedById = new Map(rendered.map((r) => [r.employee.id, r]));
  let displayRows: RowLike[] = rendered;
  if (useStoredTotals) {
    displayRows = [];
    for (const py of allPayslips) {
      if (py.voidedAt) continue;
      const emp = allEmployees.find((e) => e.id === py.employeeId);
      if (!emp) continue;
      const existing = renderedById.get(emp.id);
      const storedHours = Number(py.hoursWorked ?? 0);
      const liveHours = existing?.result.totalHours ?? 0;
      const drift = Math.abs(storedHours - liveHours) > 0.5;
      const result = {
        ...(existing?.result ?? {
          regularCents: 0,
          overtimeCents: 0,
          taskCents: 0,
          byDay: [],
        }),
        totalHours: storedHours,
        grossCents: py.grossPayCents,
        roundedCents: py.roundedPayCents,
      } as RowLike["result"];
      displayRows.push({
        employee: emp,
        result,
        incomplete: existing?.incomplete ?? 0,
        punches: existing?.punches ?? [],
        storedHours,
        liveHours,
        hoursDrift: drift,
      });
    }
    displayRows.sort((a, b) =>
      a.employee.displayName.localeCompare(b.employee.displayName),
    );
  }

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

  return (
    <div className="space-y-5">
      {/* Sticky action bar — keeps state pill, totals, primary CTAs visible
          even on long period pages. The lock/mark-paid action used to live at
          page bottom, requiring 3000px of scroll on busy weeks. */}
      {/* Static header (date + Back) sits above the sticky bar. The sticky
          bar holds only the state pills + action buttons so it never
          wraps to a second row at common laptop widths (1100-1300px),
          which was the original "buttons all over the place" complaint. */}
      <div className="space-y-2">
        <PeriodDetailBackButton
          fallbackHref={isAccountant ? "/cash-drawer" : "/payroll"}
        />
        <PageHeader
          title={formatRange(
            period.startDate,
            canonicalEndForScheduleName(
              period.startDate,
              period.endDate,
              runSchedule?.name ?? null,
            ),
          )}
          meta={[
            `${periodDayCount(
              period.startDate,
              canonicalEndForScheduleName(
                period.startDate,
                period.endDate,
                runSchedule?.name ?? null,
              ),
            )}-day period`,
            period.lockedAt
              ? `Locked ${formatShortDate(period.lockedAt, tz)}`
              : null,
            period.paidAt
              ? `Paid ${formatShortDate(period.paidAt, tz)}${
                  period.paymentMethod === "CASH"
                    ? " in cash"
                    : period.paymentMethod === "BANK"
                      ? " by bank"
                      : ""
                }`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      </div>
      {/* Stays in the content column — same card chrome as every section
          below it. The old full-bleed treatment (-mx-8, no side borders)
          read as a stray band floating between the title and the cards.
          Pins flush to the viewport (top-0): the admin shell has no desktop
          topbar — the old top-14 assumed one and left a 56px see-through
          gap above the pinned bar. */}
      <div className="rounded-card border border-border/70 bg-surface/95 p-3 shadow-card backdrop-blur lg:sticky lg:top-0 lg:z-20 lg:px-4 lg:py-2.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusPill status={period.state} />
              <SchedulePill name={headerSchedule?.name ?? null} />
              {!isAccountant && !headerScheduleId && (
                <AssignScheduleButton
                  periodId={period.id}
                  schedules={schedules
                    .filter((s) => s.active !== false)
                    .map((s) => ({
                      id: s.id,
                      name: s.name,
                      kind: s.periodKind as
                        | "WEEKLY"
                        | "BIWEEKLY"
                        | "SEMI_MONTHLY"
                        | "MONTHLY",
                    }))}
                />
              )}
              <span
                className="hidden h-5 w-px bg-border/80 sm:block"
                aria-hidden
              />
              <span className="basis-full text-sm text-text-muted tabular-nums sm:basis-auto">
                {displayRows.length}{" "}
                {displayRows.length === 1 ? "employee" : "employees"}
                {" · "}
                <HoursDisplay
                  hours={totals.hours}
                  decimals={payRules.hoursDecimalPlaces}
                />{" "}
                h{" · "}
                <span className="font-semibold text-text">
                  <MoneyDisplay
                    cents={periodGrandTotalCents}
                    monospace={false}
                  />
                </span>
                {tempWorkersTotalCents > 0 && (
                  <span className="text-xs text-text-muted">
                    {" "}
                    (incl.{" "}
                    <MoneyDisplay
                      cents={tempWorkersTotalCents}
                      monospace={false}
                    />{" "}
                    temp)
                  </span>
                )}
              </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:shrink-0 lg:flex-wrap lg:items-center lg:gap-3">
            {!isAccountant && run?.pdfPath && (
              <Button asChild variant="secondary" size="sm" className="w-full justify-center lg:w-auto">
                <PdfLink
                  href={`/api/reports/${run.id}/pdf`}
                  filename="admin-report.pdf"
                >
                  <Download className="h-4 w-4" /> PDF
                </PdfLink>
              </Button>
            )}
            {!isAccountant && (
              <>
                <PublishPeriodButton
                  periodId={period.id}
                  periodState={period.state}
                  published={!!run?.publishedToPortalAt}
                />
                <LockButtons
                  period={period}
                  incompletePunchCount={displayRows.reduce(
                    (s, r) => s + (r.incomplete ?? 0),
                    0,
                  )}
                  periodGrossRoundedCents={periodGrandTotalCents}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {!isAccountant && (
        <Card>
          <CardHeader className="gap-3 border-b-0 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle>Payroll documents</CardTitle>
              <CardDescription>
                Print while reviewing. Reports keeps the same documents for
                lookbacks.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
            <Button asChild variant="secondary" size="sm">
              <PdfLink
                href={`/api/payslips/period/${period.id}/signature`}
                filename="signature-report.pdf"
              >
                <Printer className="h-4 w-4" /> Signature report
              </PdfLink>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <PdfLink
                href={`/api/payroll/${period.id}/payslips-cut-sheet`}
                filename="payslip-cut-sheet.pdf"
              >
                <Scissors className="h-4 w-4" /> Pay-slip cut sheet
              </PdfLink>
            </Button>
            <CashDenominationButton
              summary={cashSummary}
              periodLabel={periodLabel}
            />
            <form
              className="contents"
              action={async () => {
                "use server";
                await backupAdminReportToZohoAction(period.id, run?.id ?? null);
              }}
            >
              <Button type="submit" variant="secondary" size="sm">
                <UploadCloud className="h-4 w-4" /> Back up admin report
              </Button>
            </form>
            {run?.pdfPath && (
              <Button asChild variant="secondary" size="sm">
                <PdfLink
                  href={`/api/reports/${run.id}/pdf`}
                  filename="admin-report.pdf"
                >
                  <Download className="h-4 w-4" /> Generated report PDF
                </PdfLink>
              </Button>
            )}
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Acknowledgement roll — owner ask: "where does that go right
          now there is needs to be a distinct place to see they have
          approved their pay slip". Counts active payslips by status
          (acknowledged / disputed / awaiting), with names listed
          under each bucket so admin sees exactly who's outstanding. */}
      {(() => {
        const active = allPayslips.filter((p) => !p.voidedAt);
        const ackd = active.filter(
          (p) => p.acknowledgedAt && !p.disputedAt,
        );
        const disputed = active.filter(
          (p) => p.disputedAt && !p.disputeResolvedAt,
        );
        const pending = active.filter(
          (p) => !p.acknowledgedAt && !p.disputedAt,
        );
        const nameOf = (id: string) =>
          allEmployees.find((e) => e.id === id)?.displayName ?? "—";
        if (active.length === 0) return null;
        const buckets = [
          {
            key: "acknowledged",
            label: "Acknowledged",
            dot: "bg-success-600",
            count: ackd.length,
            names: ackd.map((p) => nameOf(p.employeeId)).sort(),
          },
          {
            key: "pending",
            label: "Pending",
            dot: "bg-warning-600",
            count: pending.length,
            names: pending.map((p) => nameOf(p.employeeId)).sort(),
          },
          ...(disputed.length > 0
            ? [
                {
                  key: "disputed",
                  label: "Disputed",
                  dot: "bg-danger-600",
                  count: disputed.length,
                  names: disputed.map((p) => nameOf(p.employeeId)).sort(),
                },
              ]
            : []),
        ];
        return (
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>Payslip acknowledgements</CardTitle>
              <p className="text-caption text-text-muted tabular-nums">
                <span className="text-subheading font-semibold text-text">
                  {ackd.length}
                </span>
                <span className="text-text-subtle"> of {active.length}</span>{" "}
                acknowledged
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Stacked bar: every payslip is a segment, colored by its
                  state. A 0% single-fill bar read as an empty gray line. */}
              <div
                className="flex h-2 gap-px overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={active.length}
                aria-valuenow={ackd.length}
                aria-label="Payslips acknowledged"
              >
                {buckets
                  .filter((b) => b.count > 0)
                  .map((b) => (
                    <div
                      key={b.key}
                      className={`h-full ${b.dot} ${b.key === "pending" ? "opacity-50" : ""}`}
                      style={{ width: `${(b.count / active.length) * 100}%` }}
                      aria-hidden
                    />
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                {buckets.map((bucket) => (
                  <div key={bucket.key} className="min-w-[12rem] flex-1 space-y-2">
                    <p className="flex items-center gap-1.5 text-micro uppercase text-text-subtle">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${bucket.dot}`}
                        aria-hidden
                      />
                      {bucket.label}
                      <span className="tabular-nums">({bucket.count})</span>
                    </p>
                    {bucket.names.length === 0 ? (
                      <p className="text-xs text-text-subtle">No one yet</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {bucket.names.map((name) => (
                          <span
                            key={name}
                            className="inline-flex rounded-chip border border-border/60 bg-surface-2/60 px-2 py-0.5 text-xs text-text-muted"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Drift banner — shows when stored payslip hours diverge from
          live punch hours. Lets the admin recompute every doubled
          payslip from current punches in one click. Critical for
          fixing the legacy-import 2x bug across 15+ employees on a
          single period. */}
      {/* Employee-raised disputes — surfaces "Report a problem" reports
          from /me/pay so admin can see them and one-tap resolve. */}
      {!isAccountant && (
        <>
          <DisputesPanel
            disputes={allPayslips
              .filter((p) => p.disputedAt && !p.disputeResolvedAt && !p.voidedAt)
              .map((p) => {
                const emp = allEmployees.find((e) => e.id === p.employeeId);
                return {
                  payslipId: p.id,
                  employeeName: emp?.displayName ?? "Unknown",
                  reason: p.disputeReason ?? "",
                  disputedAt: (p.disputedAt as Date).toISOString(),
                };
              })}
          />

          <RecomputeBanner
            periodId={periodId}
            drifts={
              (displayRows
                .filter((r) => "hoursDrift" in r && r.hoursDrift)
                .map((r) => {
                  const row = r as typeof r & {
                    storedHours?: number;
                    liveHours?: number;
                  };
                  return {
                    employeeName: row.employee.displayName,
                    storedHours: row.storedHours ?? 0,
                    liveHours: row.liveHours ?? 0,
                  };
                })) as Array<{
                employeeName: string;
                storedHours: number;
                liveHours: number;
              }>
            }
          />
        </>
      )}

      {/* Per-employee summary — each row expands inline to show that
          employee's punches. Drops the separate Punches card so the
          period detail page no longer requires scrolling past every
          employee twice. */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Employee totals</CardTitle>
            <CardDescription>
              Expand a row to see that employee&apos;s daily punches.
            </CardDescription>
          </div>
          {rendered.length > 0 ? (
            <p className="text-caption text-text-muted tabular-nums">
              {displayRows.length}{" "}
              {displayRows.length === 1 ? "employee" : "employees"}
              {" · "}
              <HoursDisplay
                hours={totals.hours}
                decimals={payRules.hoursDecimalPlaces}
              />{" "}
              h
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {rendered.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-text-muted">
              No punches or task pay recorded for this period.
            </p>
          ) : (
            <>
            <div className="space-y-3 p-4 md:hidden">
              {displayRows.map((row) => {
                const { employee, result, incomplete, punches } = row;
                const ePunches = punches.filter((p) => !p.voidedAt);
                const slip = payslipByEmployee.get(employee.id);
                const pdfUrl = payslipPdfHref(slip);
                return (
                  <details
                    key={employee.id}
                    className="group rounded-card border border-border bg-surface-2/35"
                  >
                    <summary className="list-none p-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-start gap-3">
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-text-subtle transition-transform group-open:rotate-90" />
                        <div className="min-w-0 flex-1">
                          {isAccountant ? (
                            <span className="block truncate text-sm font-semibold">
                              {employee.displayName}
                            </span>
                          ) : (
                            <Link
                              href={`/employees/${employee.id}`}
                              className="block truncate text-sm font-semibold hover:text-brand-700 hover:underline underline-offset-2"
                            >
                              {employee.displayName}
                            </Link>
                          )}
                          <div className="mt-0.5 text-xs text-text-muted">
                            {rateLabel(employee)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-semibold tabular-nums">
                            <MoneyDisplay cents={result.roundedCents} />
                          </div>
                          <div className="text-micro uppercase text-text-subtle">
                            Rounded
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-input border border-border/70 bg-surface p-2">
                          <div className="text-micro uppercase text-text-subtle">
                            Hours
                          </div>
                          <div className="mt-1 font-semibold tabular-nums">
                            <HoursDisplay
                              hours={result.totalHours}
                              decimals={payRules.hoursDecimalPlaces}
                            />
                          </div>
                        </div>
                        <div className="rounded-input border border-border/70 bg-surface p-2">
                          <div className="text-micro uppercase text-text-subtle">
                            Gross
                          </div>
                          <div className="mt-1 font-semibold tabular-nums">
                            <MoneyDisplay cents={result.grossCents} />
                          </div>
                        </div>
                        <div className="rounded-input border border-border/70 bg-surface p-2">
                          <div className="text-micro uppercase text-text-subtle">
                            Issues
                          </div>
                          <div className="mt-1 truncate text-xs">
                            {issueLabel({
                              incomplete,
                              ...("hoursDrift" in row
                                ? {
                                    hoursDrift: row.hoursDrift,
                                    storedHours: (row as RowLike).storedHours,
                                    liveHours: (row as RowLike).liveHours,
                                  }
                                : {}),
                            })}
                          </div>
                        </div>
                      </div>
                      {pdfUrl ? (
                        <div className="mt-3 flex justify-end">
                          <PayslipPdfActions
                            url={pdfUrl}
                            printLabel="Print"
                            downloadLabel="PDF"
                            layout="inline"
                          />
                        </div>
                      ) : null}
                    </summary>
                    <PunchSubTable
                      punches={ePunches}
                      tz={tz}
                      formatHm={formatHm}
                      formatDayLabel={formatDayLabel}
                      periodId={periodId}
                      employeeId={employee.id}
                      canEdit={!isAccountant && period.state !== "PAID"}
                      today={new Intl.DateTimeFormat("en-CA", {
                        timeZone: tz,
                      }).format(new Date())}
                    />
                  </details>
                );
              })}
              <div className="rounded-card border border-border bg-surface-2 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Employee subtotal</span>
                  <span className="font-semibold tabular-nums">
                    <MoneyDisplay cents={totals.rounded} />
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-muted">
                  <div>
                    Hours:{" "}
                    <span className="tabular-nums text-text">
                      <HoursDisplay
                        hours={totals.hours}
                        decimals={payRules.hoursDecimalPlaces}
                      />
                    </span>
                  </div>
                  <div className="text-right">
                    Gross:{" "}
                    <span className="tabular-nums text-text">
                      <MoneyDisplay cents={totals.gross} />
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[820px]">
              <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 border-b border-border/60 bg-surface-2/40 px-5 py-2.5 text-micro uppercase text-text-subtle">
                <div></div>
                <div>Employee</div>
                <div className="text-right">Hours</div>
                <div className="text-right">Gross</div>
                <div className="text-right">Rounded</div>
                <div className="text-right">Issues</div>
                <div className="text-right">Payslip</div>
              </div>
              <div className="divide-y divide-border/60">
                {displayRows.map((row) => {
                  const { employee, result, incomplete, punches } = row;
                  const ePunches = punches.filter((p) => !p.voidedAt);
                  const slip = payslipByEmployee.get(employee.id);
                  const pdfUrl = payslipPdfHref(slip);
                  return (
                    <details key={employee.id} className="group">
                      <summary className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] cursor-pointer list-none items-center gap-x-4 px-5 py-3 text-sm transition-colors hover:bg-surface-2/40 group-open:bg-surface-2/30 [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-4 w-4 text-text-subtle transition-transform group-open:rotate-90" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          {isAccountant ? (
                            <span className="block truncate font-semibold">
                              {employee.displayName}
                            </span>
                          ) : (
                            <Link
                              href={`/employees/${employee.id}`}
                              className="font-semibold hover:text-brand-700 hover:underline underline-offset-2 truncate block"
                            >
                              {employee.displayName}
                            </Link>
                          )}
                          <div className="text-xs text-text-muted tabular-nums">
                            {rateLabel(employee)}
                          </div>
                        </div>
                        <span className="text-right tabular-nums">
                          <HoursDisplay
                            hours={result.totalHours}
                            decimals={payRules.hoursDecimalPlaces}
                          />
                        </span>
                        <span className="text-right tabular-nums">
                          <MoneyDisplay cents={result.grossCents} />
                        </span>
                        <span className="text-right tabular-nums font-semibold">
                          <MoneyDisplay cents={result.roundedCents} />
                        </span>
                        <span className="truncate text-right text-xs">
                          {issueLabel({
                            incomplete,
                            ...("hoursDrift" in row
                              ? {
                                  hoursDrift: row.hoursDrift,
                                  storedHours: (row as RowLike).storedHours,
                                  liveHours: (row as RowLike).liveHours,
                                }
                              : {}),
                          })}
                        </span>
                        <span className="flex justify-end">
                          {pdfUrl ? (
                            <PayslipPdfActions
                              url={pdfUrl}
                              printLabel="Print"
                              downloadLabel="PDF"
                              layout="inline"
                            />
                          ) : (
                            <span className="text-xs text-text-subtle">—</span>
                          )}
                        </span>
                      </summary>
                      <PunchSubTable punches={ePunches} tz={tz} formatHm={formatHm} formatDayLabel={formatDayLabel} periodId={periodId} employeeId={employee.id} canEdit={!isAccountant && period.state !== "PAID"} today={new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date())} />
                    </details>
                  );
                })}
              </div>
              <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 border-t border-border bg-surface-2/40 px-5 py-3 text-sm font-medium">
                <div></div>
                <div>Subtotal</div>
                <div className="text-right tabular-nums">
                  <HoursDisplay
                    hours={totals.hours}
                    decimals={payRules.hoursDecimalPlaces}
                  />
                </div>
                <div className="text-right tabular-nums">
                  <MoneyDisplay cents={totals.gross} />
                </div>
                <div className="text-right font-semibold tabular-nums">
                  <MoneyDisplay cents={totals.rounded} />
                </div>
                <div></div>
                <div></div>
              </div>
              {tempWorkersTotalCents > 0 && (
                <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 bg-surface-2/40 px-5 py-1.5 text-xs text-text-muted">
                  <div></div>
                  <div>+ Temp / manual labor</div>
                  <div></div>
                  <div></div>
                  <div className="text-right tabular-nums">
                    <MoneyDisplay cents={tempWorkersTotalCents} />
                  </div>
                  <div></div>
                  <div></div>
                </div>
              )}
              {tempWorkersTotalCents > 0 && (
                <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 border-t border-border bg-surface-2/40 px-5 py-3 text-sm font-semibold">
                  <div></div>
                  <div>Period grand total</div>
                  <div></div>
                  <div></div>
                  <div className="text-right tabular-nums">
                    <MoneyDisplay cents={periodGrandTotalCents} />
                  </div>
                  <div></div>
                  <div></div>
                </div>
              )}
            </div>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <TempWorkersSection
        periodId={periodId}
        initialEntries={tempWorkers}
        locked={isAccountant || period.state === "PAID"}
      />

      {!isAccountant && (
        <DedupPunchesButton
          periodId={periodId}
          initialDetails={duplicateDetails}
        />
      )}

      {!isAccountant && (
        <PayslipManageSection
          rows={allPayslips
            .map((p) => {
              const e = allEmployees.find((x) => x.id === p.employeeId);
              if (!e) return null;
              return {
                payslip: {
                  id: p.id,
                  employeeId: p.employeeId,
                  hoursWorked: p.hoursWorked,
                  roundedPayCents: p.roundedPayCents,
                  voidedAt: p.voidedAt,
                  voidReason: p.voidReason,
                  pdfPath: p.pdfPath,
                },
                employee: { id: e.id, displayName: e.displayName },
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .sort((a, b) =>
              a.employee.displayName.localeCompare(b.employee.displayName),
            )}
        />
      )}

      <PayrollDocsSection
        periodId={periodId}
        periodPayScheduleId={period.payScheduleId ?? null}
        periodKind={runSchedule?.periodKind ?? null}
        // Pass ALL active employees so the section can show salaried
        // staff alongside the requires-W2-upload flag list. The section
        // filters internally by requiresW2Upload AND schedule match,
        // and excludes salaried-on-weekly as a defensive measure.
        employees={allEmployees
          .filter((e) => e.status === "ACTIVE")
          .map((e) => ({
            id: e.id,
            displayName: e.displayName,
            requiresW2Upload: e.requiresW2Upload,
            payType: e.payType,
            payScheduleId: e.payScheduleId,
          }))}
        initialDocs={payrollDocs}
        locked={isAccountant || period.state === "PAID"}
      />

      <p className="text-xs text-text-subtle">
        {ROUNDING_LABEL[payRules.rounding]}.
        {tempWorkers.length > 0 && (
          <>
            {" "}
            Period grand total includes{" "}
            <MoneyDisplay
              cents={tempWorkers.reduce((acc, e) => acc + e.amountCents, 0)}
              monospace={false}
            />{" "}
            in temp / manual labor.
          </>
        )}
      </p>
    </div>
  );
}

export const dynamic = "force-dynamic";

function PunchSubTable({
  punches,
  tz,
  formatHm,
  formatDayLabel,
  periodId,
  employeeId,
  canEdit,
  today,
}: {
  punches: { id: string; clockIn: Date | string; clockOut: Date | string | null }[];
  tz: string;
  formatHm: (d: Date | null, tz: string) => string;
  formatDayLabel: (dateIso: string, tz: string) => string;
  periodId: string;
  employeeId: string;
  canEdit: boolean;
  today: string;
}) {
  if (punches.length === 0) {
    return <div className="px-9 pb-3 text-xs text-text-muted">No punches.</div>;
  }
  const byDay = new Map<string, typeof punches>();
  for (const p of punches) {
    const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    const day = companyDayIso(d, tz);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="overflow-x-auto px-3 pb-3 pt-1 md:px-9">
      <table className="min-w-[22rem] text-xs md:min-w-full">
        <thead className="text-left text-micro uppercase text-text-subtle border-b border-border/60">
          <tr>
            <th className="py-1 pr-3 font-semibold">Day</th>
            <th className="py-1 px-3 font-semibold">In</th>
            <th className="py-1 px-3 font-semibold">Out</th>
            <th className="py-1 px-3 font-semibold text-right">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {days.flatMap(([day, ps]) =>
            ps
              .sort((a, b) => {
                const ai = a.clockIn instanceof Date ? a.clockIn : new Date(a.clockIn);
                const bi = b.clockIn instanceof Date ? b.clockIn : new Date(b.clockIn);
                return ai.getTime() - bi.getTime();
              })
              .map((p, i) => {
                const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
                const outT = p.clockOut
                  ? p.clockOut instanceof Date
                    ? p.clockOut
                    : new Date(p.clockOut)
                  : null;
                const hours = outT
                  ? (outT.getTime() - inT.getTime()) / 3_600_000
                  : null;
                const isMissingClockOut = !outT;
                // Distinguish "still working today" from "forgot to clock out
                // on a prior day" — only show the fix link for stale open
                // punches. A punch from today with no clock-out is in-progress
                // (the device hasn't synced the clock-out yet).
                const isInProgress = isMissingClockOut && day >= today;
                const isStaleOpen = isMissingClockOut && day < today;
                return (
                  <tr key={p.id} className="hover:bg-surface-2/40">
                    <td className="py-0.5 pr-3 text-text-muted">
                      {i === 0 ? formatDayLabel(day, tz) : ""}
                    </td>
                    <td className="py-0.5 px-3 tabular-nums">{formatHm(inT, tz)}</td>
                    <td className="py-0.5 px-3 tabular-nums">
                      {isInProgress ? (
                        <span className="text-brand-700 font-medium">open</span>
                      ) : isStaleOpen && canEdit ? (
                        <Link
                          href={`/time/${periodId}/${day}/${employeeId}?${new URLSearchParams({ returnTo: `/payroll/${periodId}` })}`}
                          className="text-warning-700 underline underline-offset-2 hover:text-warning-900"
                        >
                          missing — fix
                        </Link>
                      ) : (
                        formatHm(outT, tz)
                      )}
                    </td>
                    <td className="py-0.5 px-3 text-right tabular-nums">
                      {hours !== null ? hours.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              }),
          )}
        </tbody>
      </table>
    </div>
  );
}
