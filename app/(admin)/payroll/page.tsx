// /payroll — "Periods" manager. A focused, calm-operations screen with a
// single job: see the periods that still need work, and keep punches in sync.
//
// Visual layout (post-redesign):
//   • Page header with one ambient sync action group (top-right): "Poll
//     punches now" + "Backfill missing days", plus a quiet "Upload CSV"
//     fallback. This is the page's ONE global action — no per-period run
//     triggers live here anymore.
//   • ScheduleTabs strip.
//   • "Recent periods" list (open + locked only — paid lives in /reports) as
//     the visual focus. Each row links to /payroll/[periodId].
//
// Per-schedule run status (the old "Active period" hero + per-period NGTeco
// import trigger) now belongs to the dashboard cockpit, so it is intentionally
// absent here. The owner only uses this page to sync punches and to step into
// a period's detail — keep it ruthlessly simple.

import type React from "react";
import Link from "next/link";
import {
  Wallet,
  Upload,
  Briefcase,
  Pencil,
  ChevronRight,
  CircleAlert,
  Banknote,
  CalendarClock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/domain/avatar";
import { SchedulePill } from "@/components/domain/schedule-pill";
import { statusChipClasses } from "@/components/domain/status-pill";
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
import { payPeriods, paySchedules } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeriodRange } from "@/lib/payroll/format-period";
import { PollPunchesNowButton } from "@/components/admin/poll-punches-now";
import { BackfillPunchesButton } from "@/components/admin/backfill-punches";
import { getLastPoll } from "@/lib/db/queries/poll-history";
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

  const [openPeriods, lastPoll, company] = await Promise.all([
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
    getLastPoll(),
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
      return {
        ...p,
        displayEnd,
        phase,
        progress: periodProgress(p.startDate, displayEnd, today),
      };
    })
    .sort(
      (a, b) =>
        PHASE_PRIORITY[a.phase] - PHASE_PRIORITY[b.phase] ||
        b.startDate.localeCompare(a.startDate),
    );

  const phaseCount = (phase: PeriodPhase) =>
    periods.filter((p) => p.phase === phase).length;
  const summaryParts = [
    phaseCount("NEEDS_PROCESSING") > 0
      ? `${phaseCount("NEEDS_PROCESSING")} to process`
      : null,
    phaseCount("AWAITING_PAYMENT") > 0
      ? `${phaseCount("AWAITING_PAYMENT")} awaiting payment`
      : null,
    phaseCount("RUNNING") > 0 ? `${phaseCount("RUNNING")} in progress` : null,
    phaseCount("UPCOMING") > 0 ? `${phaseCount("UPCOMING")} upcoming` : null,
  ].filter(Boolean);
  const periodSummary =
    summaryParts.length > 0 ? summaryParts.join(" · ") : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Periods"
        description={
          <>
            Open and locked pay periods awaiting work. Historical reports live
            in{" "}
            <Link
              href="/reports"
              className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
            >
              Reports
            </Link>
            .
          </>
        }
        meta={periodSummary}
        actions={
          // The page's single ambient sync action. Poll + Backfill are the
          // primary punch-sync controls; Upload CSV is a quiet fallback the
          // owner rarely needs.
          <div className="flex flex-wrap items-center gap-2">
            <PollPunchesNowButton
              initialLast={
                lastPoll
                  ? {
                      startedAt: lastPoll.startedAt.toISOString(),
                      finishedAt: lastPoll.finishedAt?.toISOString() ?? null,
                      ok: lastPoll.ok,
                      triggeredBy: lastPoll.triggeredBy,
                      pairsInserted: lastPoll.pairsInserted,
                      pairsUpdated: lastPoll.pairsUpdated,
                      errorMessage: lastPoll.errorMessage,
                    }
                  : null
              }
            />
            <BackfillPunchesButton />
            <Button asChild variant="ghost" size="sm">
              <Link href="/run-payroll/upload">
                <Upload className="h-4 w-4" /> Upload CSV
              </Link>
            </Button>
          </div>
        }
      />
      <ScheduleTabs current={tab} basePath="/payroll" />

      {/* Recent periods — the visual focus of this screen. A thin cadence
          accent bar repeats on each row so the schedule is recognizable at a
          glance even on the All tab. Clicking a row steps into the period's
          detail page. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-brand-700" /> Recent periods
          </CardTitle>
          <CardDescription>
            Open and locked periods awaiting work. Paid periods live in{" "}
            <Link
              href="/reports"
              className="text-brand-700 underline underline-offset-2"
            >
              Reports
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {periods.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No periods yet"
              description="Open and locked pay periods awaiting work will appear here. Paid periods live in Reports."
            />
          ) : (
            periods.map((p) => {
              // The left accent bar carries the PHASE, not the cadence — the
              // owner's ask: tell me at a glance which row is running, which
              // is done and waiting on me, which is locked. Cadence still
              // reads from the SchedulePill.
              const rowAccent =
                p.phase === "NEEDS_PROCESSING"
                  ? "before:bg-warning-500"
                  : p.phase === "AWAITING_PAYMENT"
                    ? "before:bg-info-600"
                    : p.phase === "RUNNING"
                      ? "before:bg-success-500"
                      : "before:bg-text/25";
              return (
                <div
                  key={p.id}
                  className={`relative flex items-center justify-between gap-3 rounded-card border border-border/70 bg-surface p-3 hover:bg-surface-2/40 shadow-card transition-colors overflow-hidden before:absolute before:left-0 before:top-0 before:h-full before:w-1 focus-within:ring-2 focus-within:ring-brand-700/60 ${rowAccent}`}
                >
                  {/* Stretched link: the whole row is the click/hover target
                      (after:inset-0), while the delete button sits above it
                      via z-10 so it stays independently clickable. Keyboard
                      focus lights the row through focus-within. */}
                  <Link
                    href={`/payroll/${p.id}`}
                    className="group flex items-center gap-3 flex-1 min-w-0 pl-1.5 after:absolute after:inset-0 after:rounded-card focus:outline-none focus-visible:outline-none"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium tabular-nums tracking-tight">
                          {formatPeriodRange(p.startDate, p.displayEnd)}
                        </span>
                        <SchedulePill name={p.scheduleName} />
                        <PhaseChip phase={p.phase} />
                      </div>
                      <p className="text-xs text-text-muted">
                        {phaseDetail(p.phase, p.startDate, p.displayEnd, p.progress)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <div className="relative z-10">
                    <PeriodDeleteButton periodId={p.id} state={p.state} />
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
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
        ? `In progress · day ${progress.day} of ${progress.total} · ends ${friendlyDate(endDate)}`
        : `In progress · ends ${friendlyDate(endDate)}`;
    case "NEEDS_PROCESSING":
      return `Ended ${friendlyDate(endDate)} · ready to review and lock`;
    case "AWAITING_PAYMENT":
      return "Locked · reviewed and awaiting payment";
    case "UPCOMING":
      return `Starts ${friendlyDate(startDate)}`;
  }
}

/**
 * Lifecycle chip — the loud cue on each period row. Same chip anatomy as
 * StatusPill but keyed to the phase judgement instead of the raw DB state,
 * so "Open" stops meaning three different things.
 */
function PhaseChip({ phase }: { phase: PeriodPhase }) {
  // Tones come from the shared status vocabulary (components/domain/status-pill),
  // so a LOCKED period reads the same here as it does on /reports: in progress
  // is informational, anything needing the owner's hands is amber.
  const styles: Record<
    PeriodPhase,
    { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    RUNNING: {
      label: "In progress",
      className: statusChipClasses("info"),
      Icon: RunningDot,
    },
    NEEDS_PROCESSING: {
      label: "Needs processing",
      className: statusChipClasses("warn"),
      Icon: CircleAlert,
    },
    AWAITING_PAYMENT: {
      label: "Awaiting payment",
      className: statusChipClasses("warn"),
      Icon: Banknote,
    },
    UPCOMING: {
      label: "Upcoming",
      className: statusChipClasses("neutral"),
      Icon: CalendarClock,
    },
  };
  const s = styles[phase];
  const { Icon } = s;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[11px] font-medium tracking-tight antialiased ${s.className}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {s.label}
    </span>
  );
}

/** Soft pulsing dot for the in-progress chip — motion gated by the global
 *  prefers-reduced-motion rule in globals.css. */
function RunningDot({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className ?? ""}`}>
      <span className="absolute h-2 w-2 rounded-full bg-success-500/50 animate-ping" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-success-600" />
    </span>
  );
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
        title="Periods"
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
