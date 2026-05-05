// Per-period admin report. v1.2 layout: two sections, one scroll.
//   • Top: employee totals (name | hours | gross | rounded | publish-pill)
//   • Bottom: punches chronologically per employee (in/out/hours per day)
// Reused for both legacy LEGACY_IMPORT runs and live cron-generated runs.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { PublishPortalButton } from "./publish-portal-button";
import { TempWorkersSection } from "./temp-workers-section";
import { listTempWorkers } from "@/lib/db/queries/temp-workers";
import { PayrollDocsSection } from "./payroll-docs-section";
import { listDocs } from "@/lib/db/queries/payroll-documents";
import { PayslipManageSection } from "./payslip-manage-section";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import { DedupPunchesButton } from "./dedup-button";
import { findDuplicatePunchClusters } from "@/lib/db/queries/punches";
import { DisputesPanel } from "./disputes-panel";
import { PeriodDetailBackButton } from "./back-button";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRange(startIso: string, endIso: string): string {
  const a = new Date(`${startIso}T12:00:00Z`);
  const b = new Date(`${endIso}T12:00:00Z`);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${MONTH_SHORT[a.getUTCMonth()]} ${String(a.getUTCDate()).padStart(2, "0")}${sameYear ? "" : `, ${a.getUTCFullYear()}`}`;
  const right = `${MONTH_SHORT[b.getUTCMonth()]} ${String(b.getUTCDate()).padStart(2, "0")}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}

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

export default async function PeriodReviewPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const period = await getPeriodById(periodId);
  if (!period) notFound();

  const [allEmployees, punches, payRules, payPeriod, company, schedules, tempWorkers, payrollDocs, allPayslips, duplicateClusters] = await Promise.all([
    listEmployees(),
    listPunches({ periodId }),
    getSetting("payRules"),
    getSetting("payPeriod"),
    getSetting("company"),
    db.select().from(paySchedules),
    listTempWorkers({ periodId }),
    listDocs({ periodId }),
    listPayslipsForPeriod(periodId, { includeVoided: true }),
    findDuplicatePunchClusters({ periodId }),
  ]);
  const tz = company.timezone ?? "America/New_York";

  // Most recent run for this period (the one that drives the publish-pill).
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.periodId, periodId))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);
  const runScheduleId = run?.payScheduleId ?? null;
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

  // Use stored payslip data when it's authoritative (LEGACY_IMPORT or any
  // PAID period). Otherwise prefer live computePay results so the admin
  // sees the latest from current punches.
  const useStoredTotals =
    period.state === "PAID" ||
    run?.source === "LEGACY_IMPORT" ||
    (payslipSum > 0 && liveTotals.rounded === 0);

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

  return (
    <div className="space-y-6">
      {/* Sticky action bar — keeps state pill, totals, primary CTAs visible
          even on long period pages. The lock/mark-paid action used to live at
          page bottom, requiring 3000px of scroll on busy weeks. */}
      {/* Static header (date + Back) sits above the sticky bar. The sticky
          bar holds only the state pills + action buttons so it never
          wraps to a second row at common laptop widths (1100-1300px),
          which was the original "buttons all over the place" complaint. */}
      <div>
        <PeriodDetailBackButton />
        <h1 className="text-xl font-semibold tracking-tight">
          {formatRange(
            period.startDate,
            canonicalEndForScheduleName(
              period.startDate,
              period.endDate,
              runSchedule?.name ?? null,
            ),
          )}
        </h1>
      </div>
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 bg-page/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
              <StatusPill status={period.state} />
              <SchedulePill name={runSchedule?.name ?? null} />
              {!period.payScheduleId && (
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
              <span className="text-sm text-text-muted">
                {displayRows.length} emp ·{" "}
                <span className="font-medium text-text">
                  <MoneyDisplay
                    cents={totals.rounded + tempWorkersTotalCents}
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
          <div className="flex items-center gap-2 shrink-0">
            {run?.pdfPath && (
              <Button asChild variant="secondary" size="sm">
                <Link
                  href={`/api/reports/${run.id}/pdf`}
                  target="_blank"
                  rel="noopener"
                >
                  <Download className="h-4 w-4" /> PDF
                </Link>
              </Button>
            )}
            {run && <PublishPortalButton run={run} />}
            <LockButtons
              period={period}
              incompletePunchCount={displayRows.reduce(
                (s, r) => s + (r.incomplete ?? 0),
                0,
              )}
            />
          </div>
        </div>
      </div>

      {/* Drift banner — shows when stored payslip hours diverge from
          live punch hours. Lets the admin recompute every doubled
          payslip from current punches in one click. Critical for
          fixing the legacy-import 2x bug across 15+ employees on a
          single period. */}
      {/* Employee-raised disputes — surfaces "Report a problem" reports
          from /me/pay so admin can see them and one-tap resolve. */}
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

      {/* Per-employee summary — each row expands inline to show that
          employee's punches. Drops the separate Punches card so the
          period detail page no longer requires scrolling past every
          employee twice. */}
      <Card>
        <CardHeader>
          <CardTitle>Employee totals</CardTitle>
        </CardHeader>
        <CardContent>
          {rendered.length === 0 ? (
            <p className="text-sm text-text-muted">
              No punches or task pay recorded for this period.
            </p>
          ) : (
            <div className="space-y-0.5">
              <div className="grid grid-cols-[24px_minmax(160px,2fr)_1fr_1fr_1fr_1fr] gap-x-3 px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
                <div></div>
                <div>Employee</div>
                <div className="text-right">Hours</div>
                <div className="text-right">Gross</div>
                <div className="text-right">Rounded</div>
                <div className="text-right">Issues</div>
              </div>
              <div className="divide-y divide-border">
                {displayRows.map((row) => {
                  const { employee, result, incomplete, punches } = row;
                  const ePunches = punches.filter((p) => !p.voidedAt);
                  return (
                    <details key={employee.id} className="group">
                      <summary className="grid grid-cols-[24px_minmax(160px,2fr)_1fr_1fr_1fr_1fr] gap-x-3 items-center px-2 py-2.5 text-sm cursor-pointer list-none hover:bg-surface-2/40 transition-colors [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-3.5 w-3.5 text-text-subtle group-open:rotate-90 transition-transform" />
                        <div className="min-w-0">
                          <Link
                            href={`/employees/${employee.id}`}
                            className="font-semibold hover:text-brand-700 hover:underline underline-offset-2 truncate block"
                          >
                            {employee.displayName}
                          </Link>
                          <div className="text-xs text-text-muted">
                            {employee.payType === "FLAT_TASK"
                              ? `Per task · ${employee.hourlyRateCents !== null ? `$${(employee.hourlyRateCents / 100).toFixed(2)}` : "—"}`
                              : employee.hourlyRateCents !== null
                                ? `$${(employee.hourlyRateCents / 100).toFixed(2)}/hr`
                                : "—"}
                          </div>
                        </div>
                        <span className="text-right font-mono tabular-nums">
                          <HoursDisplay
                            hours={result.totalHours}
                            decimals={payRules.hoursDecimalPlaces}
                          />
                        </span>
                        <span className="text-right font-mono tabular-nums">
                          <MoneyDisplay cents={result.grossCents} />
                        </span>
                        <span className="text-right font-mono tabular-nums font-semibold">
                          <MoneyDisplay cents={result.roundedCents} />
                        </span>
                        <span className="text-right">
                          {incomplete > 0 ? (
                            <span className="text-warn-700 text-xs">{incomplete} incomplete</span>
                          ) : "hoursDrift" in row && row.hoursDrift ? (
                            <span
                              className="text-amber-700 text-xs"
                              title={`Stored hours (${(row as RowLike).storedHours?.toFixed(2)}h) don't match live punch hours (${(row as RowLike).liveHours?.toFixed(2)}h). Open employees row to inspect; expand to see daily punches. Use "Recompute payslip" on the run page to overwrite stored with live.`}
                            >
                              ⚠ stored {(row as RowLike).storedHours?.toFixed(2)}h ≠
                              live {(row as RowLike).liveHours?.toFixed(2)}h
                            </span>
                          ) : (
                            <span className="text-text-subtle">—</span>
                          )}
                        </span>
                      </summary>
                      <PunchSubTable punches={ePunches} tz={tz} formatHm={formatHm} formatDayLabel={formatDayLabel} />
                    </details>
                  );
                })}
              </div>
              <div className="grid grid-cols-[24px_minmax(160px,2fr)_1fr_1fr_1fr_1fr] gap-x-3 items-center px-2 py-2 border-t-2 border-border text-sm font-medium">
                <div></div>
                <div>Employee subtotal</div>
                <div className="text-right font-mono tabular-nums">
                  <HoursDisplay
                    hours={totals.hours}
                    decimals={payRules.hoursDecimalPlaces}
                  />
                </div>
                <div className="text-right font-mono tabular-nums">
                  <MoneyDisplay cents={totals.gross} />
                </div>
                <div className="text-right font-mono tabular-nums">
                  <MoneyDisplay cents={totals.rounded} />
                </div>
                <div></div>
              </div>
              {tempWorkersTotalCents > 0 && (
                <div className="grid grid-cols-[24px_minmax(160px,2fr)_1fr_1fr_1fr_1fr] gap-x-3 items-center px-2 py-1 text-xs text-text-muted">
                  <div></div>
                  <div>+ Temp / manual labor</div>
                  <div></div>
                  <div></div>
                  <div className="text-right font-mono tabular-nums">
                    <MoneyDisplay cents={tempWorkersTotalCents} />
                  </div>
                  <div></div>
                </div>
              )}
              {tempWorkersTotalCents > 0 && (
                <div className="grid grid-cols-[24px_minmax(160px,2fr)_1fr_1fr_1fr_1fr] gap-x-3 items-center px-2 py-2 border-t border-border text-sm font-semibold">
                  <div></div>
                  <div>Period grand total</div>
                  <div></div>
                  <div></div>
                  <div className="text-right font-mono tabular-nums">
                    <MoneyDisplay cents={totals.rounded + tempWorkersTotalCents} />
                  </div>
                  <div></div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TempWorkersSection
        periodId={periodId}
        initialEntries={tempWorkers}
        locked={period.state === "PAID"}
      />

      <DedupPunchesButton
        periodId={periodId}
        initialClusterCount={duplicateClusters.length}
      />

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
              },
              employee: { id: e.id, displayName: e.displayName },
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) =>
            a.employee.displayName.localeCompare(b.employee.displayName),
          )}
      />

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
        locked={period.state === "PAID"}
      />

      <p className="text-xs text-text-muted">
        Rounding: {payRules.rounding}. Period length: {payPeriod.lengthDays} days.
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
}: {
  punches: { id: string; clockIn: Date | string; clockOut: Date | string | null }[];
  tz: string;
  formatHm: (d: Date | null, tz: string) => string;
  formatDayLabel: (dateIso: string, tz: string) => string;
}) {
  if (punches.length === 0) {
    return <div className="px-9 pb-3 text-xs text-text-muted">No punches.</div>;
  }
  const byDay = new Map<string, typeof punches>();
  for (const p of punches) {
    const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="px-9 pb-3 pt-1">
      <table className="min-w-full text-xs">
        <thead className="text-left text-[9px] uppercase tracking-wider text-text-subtle border-b border-border/60">
          <tr>
            <th className="py-1 pr-3 font-medium">Day</th>
            <th className="py-1 px-3 font-medium">In</th>
            <th className="py-1 px-3 font-medium">Out</th>
            <th className="py-1 px-3 font-medium text-right">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
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
                return (
                  <tr key={p.id} className="hover:bg-surface-2/30">
                    <td className="py-0.5 pr-3 text-text-muted">
                      {i === 0 ? formatDayLabel(day, tz) : ""}
                    </td>
                    <td className="py-0.5 px-3 font-mono">{formatHm(inT, tz)}</td>
                    <td className="py-0.5 px-3 font-mono">{formatHm(outT, tz)}</td>
                    <td className="py-0.5 px-3 text-right font-mono tabular-nums">
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
