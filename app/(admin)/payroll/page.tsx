// /payroll — "Periods" manager. A focused, calm-operations screen with a
// single job: see the periods that still need work, and keep punches in sync.
//
// Visual layout (post-redesign):
//   • Reports-style header (breadcrumb, title, one-line context) with a
//     link to Reports. Punch sync (Poll now / Backfill / Upload CSV) moved
//     to /time in Sep 2026 — owner: it belongs with the punches.
//   • Four KPI cards: awaiting payment, in progress, needs processing,
//     incomplete punches — same card treatment as /reports.
//   • ScheduleTabs strip.
//   • "Recent periods" list (open + locked only — paid lives in /reports) as
//     the visual focus. Each row links to /payroll/[periodId].
//
// Per-schedule run status (the old "Active period" hero + per-period NGTeco
// import trigger) now belongs to the dashboard cockpit, so it is intentionally
// absent here. The owner only uses this page to sync punches and to step into
// a period's detail — keep it ruthlessly simple.

import Link from "next/link";
import {
  Wallet,
  FileText,
  Briefcase,
  Pencil,
  ChevronRight,
  CalendarClock,
  AlertTriangle,
  Banknote,
  ClipboardCheck,
  CalendarPlus,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { Avatar } from "@/components/domain/avatar";
import { SchedulePill } from "@/components/domain/schedule-pill";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
  type ScheduleTab,
} from "@/components/domain/schedule-tabs";
import { listEmployees } from "@/lib/db/queries/employees";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { listVisibleDocsByEmployee } from "@/lib/db/queries/payroll-documents";
import { SalariedUploadSlot } from "@/app/(admin)/salaried/salaried-upload-slot";
import { canonicalEndForScheduleName } from "@/lib/payroll/period-boundaries";
import {
  resolvePeriodPhase,
  periodProgress,
  PHASE_PRIORITY,
  type PeriodPhase,
} from "@/lib/payroll/period-status";
import { getSetting } from "@/lib/settings/runtime";
import { db } from "@/lib/db";
import { payPeriods, paySchedules, punches, payslips } from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { wallClockToUtc } from "@/lib/time/wall-clock";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeriodRange } from "@/lib/payroll/format-period";
import { PeriodsKpiCards } from "@/components/payroll/periods-kpi-cards";
import { PeriodDeleteButton } from "./period-delete-button";

export const dynamic = "force-dynamic";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string }>;
}) {
  const sp = await searchParams;
  const tab = parseScheduleTab(sp.schedule);
  const kindFilter = scheduleTabToKind(tab);

  // Salaried tab is a fundamentally different workflow — no payroll
  // runs, no period detail, just paystub uploads per employee. Render
  // the salaried list inline instead of forcing the admin to navigate
  // away. Owner directive: workflows STAY SEPARATE — weekly, semi-
  // monthly, salaried each get their own dedicated experience.
  if (tab === "salaried") {
    return <SalariedTabBody currentTab={tab} />;
  }

  const [openPeriods, company] = await Promise.all([
    (async () => {
      // "Recent periods" = the period(s) the admin still has work to do on.
      // PAID periods are historical — they belong in /reports, not on the
      // periods-manager page. Filter them out at the query level.
      const base = db
        .select({
          id: payPeriods.id,
          startDate: payPeriods.startDate,
          endDate: payPeriods.endDate,
          state: payPeriods.state,
          scheduleName: paySchedules.name,
          scheduleKind: paySchedules.periodKind,
        })
        .from(payPeriods)
        .leftJoin(paySchedules, eq(payPeriods.payScheduleId, paySchedules.id));
      const stateFilter = sql`${payPeriods.state} IN ('OPEN','LOCKED')`;
      const q = kindFilter
        ? base.where(
            sql`${paySchedules.periodKind} = ${kindFilter} AND ${stateFilter}`,
          )
        : base.where(stateFilter);
      return q.orderBy(desc(payPeriods.startDate)).limit(8);
    })(),
    getSetting("company").catch(() => null),
  ]);

  // "Today" in the company timezone — the anchor every phase judgement
  // hangs off. en-CA yields YYYY-MM-DD, matching the stored date strings.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: company?.timezone ?? "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Per-row figures so the list answers "how big is this period" without
  // opening it. Two grouped aggregates over at most 8 period ids: live punch
  // figures for every row, and stored payslip totals for LOCKED rows (the
  // money is only real once payslips exist — OPEN rows show hours, not $).
  const periodIds = openPeriods.map((p) => p.id);
  const tz = company?.timezone ?? "America/New_York";
  const todayStartIso = (wallClockToUtc(`${today}T00:00`, tz) ?? new Date()).toISOString();
  const [punchAgg, payslipAgg] = periodIds.length
    ? await Promise.all([
        db
          .select({
            periodId: punches.periodId,
            employees: sql<string>`count(distinct ${punches.employeeId})`,
            hours: sql<string>`coalesce(sum(extract(epoch from (${punches.clockOut} - ${punches.clockIn})) / 3600) filter (where ${punches.clockOut} is not null), 0)`,
            incomplete: sql<string>`count(*) filter (where ${punches.clockOut} is null and ${punches.clockIn} < ${todayStartIso}::timestamptz)`,
          })
          .from(punches)
          .where(and(isNull(punches.voidedAt), inArray(punches.periodId, periodIds)))
          .groupBy(punches.periodId),
        db
          .select({
            periodId: payslips.periodId,
            employees: sql<string>`count(*)`,
            hours: sql<string>`coalesce(sum(${payslips.hoursWorked}), 0)`,
            totalCents: sql<string>`coalesce(sum(${payslips.roundedPayCents}), 0)`,
          })
          .from(payslips)
          .where(and(isNull(payslips.voidedAt), inArray(payslips.periodId, periodIds)))
          .groupBy(payslips.periodId),
      ])
    : [[], []];
  const punchByPeriod = new Map(punchAgg.map((r) => [r.periodId, r]));
  const payslipByPeriod = new Map(payslipAgg.map((r) => [r.periodId, r]));

  // Resolve each period's lifecycle phase up front, then order the list by
  // urgency: needs-processing first, then locked awaiting payment, then
  // running, then upcoming. Within a phase, newest first.
  const periods = openPeriods
    .map((p) => {
      const displayEnd = canonicalEndForScheduleName(
        p.startDate,
        p.endDate,
        p.scheduleName,
      );
      const phase = resolvePeriodPhase({
        startDate: p.startDate,
        endDate: displayEnd,
        state: p.state,
        today,
      });
      const live = punchByPeriod.get(p.id);
      const stored = payslipByPeriod.get(p.id);
      const figures =
        stored && Number(stored.employees) > 0
          ? {
              employees: Number(stored.employees),
              hours: Number(stored.hours),
              totalCents: Number(stored.totalCents) as number | null,
            }
          : {
              employees: Number(live?.employees ?? 0),
              hours: Number(live?.hours ?? 0),
              totalCents: null as number | null,
            };
      return {
        ...p,
        displayEnd,
        phase,
        progress: periodProgress(p.startDate, displayEnd, today),
        figures,
        incomplete: Number(live?.incomplete ?? 0),
      };
    })
    .sort(
      (a, b) =>
        PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase] ||
        b.startDate.localeCompare(a.startDate),
    );

  const phaseCount = (phase: PeriodPhase) =>
    periods.filter((p) => p.phase === phase).length;
  const kpis = {
    awaiting: periods.filter((p) => p.phase === "AWAITING_PAYMENT"),
    running: periods.filter((p) => p.phase === "RUNNING"),
    toProcess: periods.filter((p) => p.phase === "NEEDS_PROCESSING"),
    incomplete: periods.reduce((n, p) => n + p.incomplete, 0),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-subtle">
            <span>Payroll</span>
            <ChevronRight className="h-3 w-3" aria-hidden />
          </nav>
          <h1 className="mt-0.5 text-title tracking-tight antialiased text-text">Pay Periods</h1>
          <p className="mt-1 text-sm text-text-muted">
            Open and locked pay periods that still need work. Paid periods live in Reports.
          </p>
        </div>
        <Button asChild variant="secondary" size="sm" className="h-10">
          <Link href="/reports">
            <FileText className="h-4 w-4" /> Reports
          </Link>
        </Button>
      </div>

      <PeriodsKpiCards
        awaitingCount={kpis.awaiting.length}
        awaitingCents={kpis.awaiting.reduce((n, p) => n + (p.figures.totalCents ?? 0), 0)}
        runningCount={kpis.running.length}
        runningHours={kpis.running.reduce((n, p) => n + p.figures.hours, 0)}
        toProcessCount={kpis.toProcess.length}
        incompletePunches={kpis.incomplete}
      />

      <ScheduleTabs current={tab} basePath="/payroll" />

      {/* One card per lifecycle phase, in the order the work happens. Each
          card opens with a coloured band that names the phase, says what to
          do, and totals it, so the three kinds of period no longer read as
          one undifferentiated table. (Before: a single table whose group
          headers were 10px labels on a faint tint.) */}
      {periods.length === 0 ? (
        <div className="overflow-hidden rounded-card border border-border/70 bg-surface shadow-card">
          <EmptyState
            icon={Wallet}
            title="No periods need work"
            description="Open and locked pay periods will appear here. Paid periods live in Reports."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {PHASE_ORDER.filter((ph) => phaseCount(ph) > 0).map((ph) => {
            const meta = PHASE_META[ph];
            const rows = periods.filter((p) => p.phase === ph);
            const groupHours = rows.reduce((n, p) => n + p.figures.hours, 0);
            const groupCents = rows.reduce(
              (n, p) => n + (p.figures.totalCents ?? 0),
              0,
            );
            const hasTotal = rows.some((p) => p.figures.totalCents !== null);
            return (
              <section
                key={ph}
                id={meta.anchor}
                aria-labelledby={`${meta.anchor}-title`}
                className="scroll-mt-4 overflow-hidden rounded-card border border-border/70 bg-surface shadow-card"
              >
                <header
                  className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-l-4 border-b-border/60 px-5 py-3 ${meta.band}`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <meta.Icon
                      className={`mt-0.5 h-5 w-5 shrink-0 ${meta.icon}`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <h2
                        id={`${meta.anchor}-title`}
                        className="flex items-center gap-2 text-subheading tracking-tight text-text"
                      >
                        {meta.label}
                        <span className="rounded-chip border border-border/70 bg-surface px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-text-muted">
                          {rows.length}
                        </span>
                      </h2>
                      <p className="mt-0.5 text-xs text-text-muted">{meta.hint}</p>
                    </div>
                  </div>
                  <p className="text-right text-xs tabular-nums text-text-muted">
                    {groupHours > 0 ? (
                      <>
                        <HoursDisplay hours={groupHours} decimals={2} /> h
                      </>
                    ) : null}
                    {hasTotal ? (
                      <span className="ml-3 text-sm font-semibold text-text">
                        <MoneyDisplay cents={groupCents} />
                      </span>
                    ) : null}
                  </p>
                </header>
                <div
                  className={`hidden md:grid ${LIST_GRID} items-center gap-x-4 border-b border-border/60 px-5 py-2 text-micro uppercase text-text-subtle`}
                >
                  <div>Pay period</div>
                  <div>Schedule</div>
                  <div className="text-right">Employees</div>
                  <div className="text-right">Hours</div>
                  <div className="text-right">Total</div>
                  <div />
                </div>
                <div className="divide-y divide-border/60">
                  {rows.map((p) => (
                    <PeriodRow key={p.id} p={p} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Each row is its own grid, so every track is fixed or the one flexible
// column; the last track holds the delete control and the action label.
const LIST_GRID =
  "md:grid-cols-[minmax(0,1.6fr)_8rem_6rem_6rem_7.5rem_8.5rem]";

const PHASE_ORDER: PeriodPhase[] = [
  "NEEDS_PROCESSING",
  "AWAITING_PAYMENT",
  "RUNNING",
  "UPCOMING",
];

// Colour follows the status vocabulary (see status-pill.tsx): amber = someone
// has to act, brand = money is ready to go out, blue = in progress and
// nothing to do, neutral = not started. The same colour and icon are used on
// the matching summary tile above the list.
const PHASE_META: Record<
  PeriodPhase,
  {
    label: string;
    anchor: string;
    hint: string;
    Icon: React.ComponentType<{ className?: string }>;
    band: string;
    icon: string;
    /** Label on the right of each row; null = a plain chevron. */
    action: string | null;
    actionClass: string;
  }
> = {
  NEEDS_PROCESSING: {
    label: "Needs processing",
    anchor: "needs-processing",
    hint: "These periods have ended. Review the hours, then lock each one.",
    Icon: ClipboardCheck,
    band: "border-l-warning-500 bg-warning-500/10",
    icon: "text-warning-600",
    action: "Review",
    actionClass: "border-warning-500/40 bg-warning-500/10 text-warning-800",
  },
  AWAITING_PAYMENT: {
    label: "Awaiting payment",
    anchor: "awaiting-payment",
    hint: "Reviewed and locked. Pay each one to close it out.",
    Icon: Banknote,
    band: "border-l-brand-700 bg-brand-700/10",
    icon: "text-brand-700 dark:text-brand-400",
    action: "Pay",
    actionClass:
      "border-brand-700/40 bg-brand-700/10 text-brand-800 dark:border-brand-400/40 dark:text-brand-300",
  },
  RUNNING: {
    label: "In progress",
    anchor: "in-progress",
    hint: "Still collecting hours. Nothing to do until the period ends.",
    Icon: CalendarClock,
    band: "border-l-info-600 bg-info-600/10",
    icon: "text-info-600",
    action: null,
    actionClass: "",
  },
  UPCOMING: {
    label: "Upcoming",
    anchor: "upcoming",
    hint: "Has not started yet.",
    Icon: CalendarPlus,
    band: "border-l-border-strong bg-surface-2",
    icon: "text-text-subtle",
    action: null,
    actionClass: "",
  },
};

type PeriodRowData = {
  id: string;
  state: "OPEN" | "LOCKED" | "PAID";
  startDate: string;
  displayEnd: string;
  scheduleName: string | null;
  phase: PeriodPhase;
  progress: { day: number; total: number } | null;
  figures: { employees: number; hours: number; totalCents: number | null };
  incomplete: number;
};

function PeriodRow({ p }: { p: PeriodRowData }) {
  const detail = phaseDetail(p.phase, p.startDate, p.displayEnd, p.progress);
  const meta = PHASE_META[p.phase];
  return (
    <div
      className={`group relative grid grid-cols-1 gap-y-2 px-5 py-2.5 transition-colors hover:bg-surface-2/40 focus-within:bg-surface-2/40 md:grid md:items-center md:gap-x-4 ${LIST_GRID}`}
    >
      {/* Stretched link: the whole row is the target; the delete control
          sits above it (z-10) so it stays independently clickable. */}
      <Link
        href={`/payroll/${p.id}`}
        className="min-w-0 after:absolute after:inset-0 focus:outline-none"
      >
        <span className="block truncate text-sm font-medium tabular-nums tracking-tight text-text">
          {formatPeriodRange(p.startDate, p.displayEnd)}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <span>{detail}</span>
          {p.incomplete > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-chip border border-warning-500/40 bg-warning-500/10 px-1.5 py-0.5 text-[11px] font-medium text-warning-800">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {p.incomplete} incomplete punch{p.incomplete === 1 ? "" : "es"}
            </span>
          ) : null}
        </span>
        {p.phase === "RUNNING" && p.progress ? (
          // How far through the period we are, at a glance.
          <span
            className="mt-1.5 block h-1 w-40 max-w-full overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Period progress"
            aria-valuemin={0}
            aria-valuemax={p.progress.total}
            aria-valuenow={p.progress.day}
          >
            <span
              className="block h-full rounded-full bg-info-600"
              style={{
                width: `${Math.min(100, Math.round((p.progress.day / p.progress.total) * 100))}%`,
              }}
            />
          </span>
        ) : null}
      </Link>
      <div>
        <SchedulePill name={p.scheduleName} />
      </div>
      {/* Figures: a compact sentence on phones, three aligned columns on md+. */}
      <p className="text-xs text-text-muted tabular-nums md:hidden">
        {p.figures.employees} employee{p.figures.employees === 1 ? "" : "s"}
        {" · "}
        <HoursDisplay hours={p.figures.hours} decimals={2} /> h
        {p.figures.totalCents !== null ? (
          <>
            {" · "}
            <span className="font-medium text-text">
              <MoneyDisplay cents={p.figures.totalCents} />
            </span>
          </>
        ) : null}
      </p>
      <span className="hidden text-right text-sm tabular-nums text-text md:block">
        {p.figures.employees > 0 ? p.figures.employees : <span className="text-text-subtle">—</span>}
      </span>
      <span className="hidden text-right text-sm tabular-nums text-text md:block">
        {p.figures.hours > 0 ? (
          <HoursDisplay hours={p.figures.hours} decimals={2} />
        ) : (
          <span className="text-text-subtle">—</span>
        )}
      </span>
      <span className="hidden text-right text-sm font-medium tabular-nums text-text md:block">
        {p.figures.totalCents !== null ? (
          <MoneyDisplay cents={p.figures.totalCents} />
        ) : (
          <span className="font-normal text-text-subtle">—</span>
        )}
      </span>
      <div className="absolute right-4 top-3 flex items-center justify-end gap-1 md:static">
        <div className="relative z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <PeriodDeleteButton periodId={p.id} state={p.state} />
        </div>
        {/* What opening this row is for. Decorative: the row link above is
            the real target, so this is hidden from assistive tech. */}
        {meta.action ? (
          <span
            aria-hidden
            className={`hidden items-center gap-0.5 rounded-input border px-2 py-1 text-xs font-medium md:inline-flex ${meta.actionClass}`}
          >
            {meta.action}
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        ) : (
          <ChevronRight
            className="hidden h-4 w-4 text-text-subtle transition-transform group-hover:translate-x-0.5 md:block"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

/** "Jul 12" — friendly label for a YYYY-MM-DD date string. */
function friendlyDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** One plain-English sentence describing where the period stands. */
function phaseDetail(
  phase: PeriodPhase,
  startDate: string,
  endDate: string,
  progress: { day: number; total: number } | null,
): string {
  switch (phase) {
    case "RUNNING":
      return progress
        ? `Day ${progress.day} of ${progress.total} · ends ${friendlyDate(endDate)}`
        : `Ends ${friendlyDate(endDate)}`;
    case "NEEDS_PROCESSING":
      return `Ended ${friendlyDate(endDate)}`;
    case "AWAITING_PAYMENT":
      return "Locked";
    case "UPCOMING":
      return `Starts ${friendlyDate(startDate)}`;
  }
}

/**
 * Salaried branch of /payroll — strict workflow isolation.
 *
 * Rules (owner directive — repeated):
 *   - Only payType === SALARIED employees show here.
 *   - No payroll runs, no period detail, no time grid.
 *   - Per-employee paystub upload slot is the entire UI.
 *   - SchedulePill on each row tells the admin which cadence the
 *     paystub is for (Juan would NOT show here — he's on a
 *     SEMI_MONTHLY schedule and lives under that tab).
 */
const SALARIED_PERIOD_KIND_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  SEMI_MONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
};

async function SalariedTabBody({ currentTab }: { currentTab: ScheduleTab }) {
  const all = await listEmployees({ status: "ACTIVE" });
  // STRICT: only employees who have NO weekly/semi-monthly schedule
  // attached. A SALARIED employee on a SEMI_MONTHLY schedule (e.g.
  // Juan) belongs under the Semi-monthly tab, NOT here.
  const salariedExclusive = all.filter((e) => {
    if (e.payType !== "SALARIED") return false;
    return true; // schedule-aware filter happens below using the join
  });
  // One batch query for every salaried employee's docs (was N+1), plus the
  // schedule lookup so the cadence chip renders server-side in the header.
  const [docsMap, schedules] = await Promise.all([
    listVisibleDocsByEmployee(salariedExclusive.map((e) => e.id)),
    listSchedules(),
  ]);
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const cards = salariedExclusive.map((e) => ({
    employee: e,
    docs: docsMap.get(e.id) ?? [],
    schedule: e.payScheduleId ? scheduleById.get(e.payScheduleId) ?? null : null,
  }));
  return (
    <div className="space-y-5">
      {/* Identical header + tabs markup to the non-salaried branch so the
          tab strip never shifts vertically when you switch cadences. The
          salaried-specific note moved below the tabs. */}
      <PageHeader
        title="Pay Periods"
        description={
          <>
            Salaried staff are paid externally. Historical reports live in{" "}
            <Link
              href="/reports"
              className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              Reports
            </Link>
            .
          </>
        }
        meta={`${salariedExclusive.length} salaried employee${
          salariedExclusive.length === 1 ? "" : "s"
        }`}
      />
      <ScheduleTabs current={currentTab} basePath="/payroll" />

      {salariedExclusive.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No salaried employees yet"
          description={`Set an employee's classification to "Salaried (W2)" on their profile.`}
          action={
            <Button asChild variant="secondary">
              <Link href="/employees">Open employees</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {cards.map(({ employee, docs, schedule }) => (
            <Card key={employee.id} className="overflow-hidden">
              <CardHeader className="border-b-0 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar name={employee.displayName} size="md" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>
                          {employee.displayName}
                        </CardTitle>
                        {/* Cadence is employee-level context, so it lives in
                            the header — not floating inside the upload area. */}
                        {schedule ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-chip bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-muted ring-1 ring-inset ring-border/70">
                            <CalendarClock className="h-3 w-3" aria-hidden />
                            {SALARIED_PERIOD_KIND_LABEL[schedule.periodKind] ??
                              schedule.periodKind}
                          </span>
                        ) : (
                          <Link
                            href={`/employees/${employee.id}`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-chip bg-warning-50 px-2 py-0.5 text-[10px] font-medium text-warning-700 ring-1 ring-inset ring-warning-200 underline-offset-2 hover:underline"
                          >
                            <CalendarClock className="h-3 w-3" aria-hidden />
                            No schedule — set one
                          </Link>
                        )}
                      </div>
                      <CardDescription>
                        {employee.email}
                        {docs.length > 0
                          ? ` · ${docs.length} document${docs.length === 1 ? "" : "s"} on file`
                          : " · no documents yet"}
                      </CardDescription>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/employees/${employee.id}`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                <SalariedUploadSlot
                  employeeId={employee.id}
                  docs={docs.map((d) => ({
                    id: d.id,
                    originalFilename: d.originalFilename,
                    kind: d.kind,
                    uploadedAt: d.uploadedAt.toISOString(),
                    payPeriodStart: d.payPeriodStart,
                    payPeriodEnd: d.payPeriodEnd,
                    amountCents: d.amountCents,
                    zohoExpenseId: d.zohoExpenseId,
                  }))}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
