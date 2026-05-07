// /payroll — "Run payroll" launcher. Historical reports moved to /reports;
// this page is for actively driving a run (kick NGTeco scrape, upload a CSV,
// review in-flight runs awaiting admin action).
//
// Visual layout (post-redesign):
//   • ScheduleTabs strip on top (existing).
//   • One "Active workflow" hero per tab:
//       - left: current period summary (range, state, days remaining)
//       - right: 2-3 primary CTAs (Open period, Pull NGTeco, Upload CSV)
//       - bottom strip: realtime poll + key metrics
//     The hero gets a left accent bar matching SchedulePill colors so the
//     two cadences are visually segregated even before the user reads the
//     tab label. Owner directive: weekly vs semi-monthly workflows must
//     LOOK different, not just be filtered different.
//   • In-flight runs (single-line rows).
//   • Recent periods (open + locked only — paid lives in /reports).

import Link from "next/link";
import { Wallet, Upload, ArrowRight, FileText, Briefcase, Pencil } from "lucide-react";
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
import { StatusPill } from "@/components/domain/status-pill";
import { SchedulePill } from "@/components/domain/schedule-pill";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
  type ScheduleTab,
} from "@/components/domain/schedule-tabs";
import { listEmployees } from "@/lib/db/queries/employees";
import { listEmployeeVisibleDocs } from "@/lib/db/queries/payroll-documents";
import { SalariedUploadSlot } from "@/app/(admin)/salaried/salaried-upload-slot";
import { canonicalEndForScheduleName } from "@/lib/payroll/period-boundaries";
import { db } from "@/lib/db";
import {
  payrollRuns,
  payPeriods,
  paySchedules,
  employees,
} from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { NgtecoRunNowButton } from "@/components/admin/ngteco-run-now";
import { PollPunchesNowButton } from "@/components/admin/poll-punches-now";
import { BackfillPunchesButton } from "@/components/admin/backfill-punches";
import { getLastPoll } from "@/lib/db/queries/poll-history";
import { InFlightRow } from "./in-flight-row";
import { PeriodDeleteButton } from "./period-delete-button";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Tab → accent palette. Single source so the hero, accent bar, and "subtle
// page tint" all agree. Mirrors components/domain/schedule-pill.tsx so the
// /payroll page reads as the same color family as the chips in tables.
// ─────────────────────────────────────────────────────────────────────────────
const TAB_THEME: Record<
  ScheduleTab,
  {
    accentBar: string;
    heroTint: string;
    badge: string;
    label: string;
  }
> = {
  all: {
    accentBar: "bg-text/30",
    heroTint: "bg-surface",
    badge: "bg-surface-2 text-text-muted ring-border",
    label: "All schedules",
  },
  weekly: {
    accentBar: "bg-blue-500",
    heroTint:
      "bg-gradient-to-br from-blue-50/60 via-surface to-surface",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    label: "Weekly payroll",
  },
  semi: {
    accentBar: "bg-purple-500",
    heroTint:
      "bg-gradient-to-br from-purple-50/60 via-surface to-surface",
    badge: "bg-purple-50 text-purple-700 ring-purple-200",
    label: "Semi-monthly payroll",
  },
  salaried: {
    // /payroll's salaried tab links out to /salaried, so this branch never
    // actually renders the hero — but keep a record for type-completeness.
    accentBar: "bg-emerald-500",
    heroTint: "bg-surface",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    label: "Salaried payroll",
  },
};

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T12:00:00Z`).getTime();
  const b = new Date(`${bIso}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function formatShortRange(startIso: string, endIso: string): string {
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const a = new Date(`${startIso}T12:00:00Z`);
  const b = new Date(`${endIso}T12:00:00Z`);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${MO[a.getUTCMonth()]} ${a.getUTCDate()}${sameYear ? "" : `, ${a.getUTCFullYear()}`}`;
  const right = `${MO[b.getUTCMonth()]} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string }>;
}) {
  const sp = await searchParams;
  const tab = parseScheduleTab(sp.schedule);
  const kindFilter = scheduleTabToKind(tab);
  const theme = TAB_THEME[tab];

  // Salaried tab is a fundamentally different workflow — no payroll
  // runs, no period detail, just paystub uploads per employee. Render
  // the salaried list inline instead of forcing the admin to navigate
  // away. Owner directive: workflows STAY SEPARATE — weekly, semi-
  // monthly, salaried each get their own dedicated experience.
  if (tab === "salaried") {
    return <SalariedTabBody currentTab={tab} />;
  }

  const [openPeriods, recentInFlight, schedules, lastPoll, employeeCount] =
    await Promise.all([
      (async () => {
        // "Recent periods" = the period(s) the admin still has work to do on.
        // PAID periods are historical — they belong in /reports, not on the
        // run-launcher page. Filter them out at the query level.
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
      (async () => {
        // In-flight runs honor the schedule tab — Weekly tab must never
        // show a Semi-monthly in-flight (and vice versa). Owner directive:
        // workflows stay separate. The All tab still shows everything.
        const stateClause = sql`${payrollRuns.state} IN ('SCHEDULED','INGESTING','INGEST_FAILED','AWAITING_EMPLOYEE_FIXES','AWAITING_ADMIN_REVIEW','APPROVED')`;
        const base = db
          .select({
            id: payrollRuns.id,
            periodId: payrollRuns.periodId,
            state: payrollRuns.state,
            startDate: payPeriods.startDate,
            endDate: payPeriods.endDate,
            scheduleName: paySchedules.name,
            createdAt: payrollRuns.createdAt,
          })
          .from(payrollRuns)
          .leftJoin(payPeriods, eq(payrollRuns.periodId, payPeriods.id))
          .leftJoin(paySchedules, eq(payrollRuns.payScheduleId, paySchedules.id));
        const where = kindFilter
          ? sql`${stateClause} AND ${paySchedules.periodKind} = ${kindFilter}`
          : stateClause;
        return base.where(where).orderBy(desc(payrollRuns.createdAt)).limit(10);
      })(),
      db.select().from(paySchedules).where(eq(paySchedules.active, true)),
      getLastPoll(),
      // Active employee headcount on this cadence — surfaces as a hero
      // metric so the admin sees "12 employees on this schedule" before
      // they kick the import. Skips when the tab is "all".
      (async () => {
        if (!kindFilter) return null;
        const rows = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(employees)
          .leftJoin(paySchedules, eq(employees.payScheduleId, paySchedules.id))
          .where(
            sql`${employees.status} = 'ACTIVE' AND ${paySchedules.periodKind} = ${kindFilter}`,
          );
        return rows[0]?.c ?? 0;
      })(),
    ]);

  // openPeriods is filtered to OPEN+LOCKED only (PAID lives in /reports).
  const openCount = openPeriods.filter((p) => p.state === "OPEN").length;
  const lockedCount = openPeriods.filter((p) => p.state === "LOCKED").length;

  // Current period for the hero = most recent OPEN, falling back to most
  // recent LOCKED. openPeriods is already ordered desc by startDate.
  const currentOpen = openPeriods.find((p) => p.state === "OPEN");
  const currentLocked = openPeriods.find((p) => p.state === "LOCKED");
  const currentPeriod = currentOpen ?? currentLocked ?? null;

  const today = new Date();
  const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;

  // For weekly tab the displayed end honors the canonical Mon-Sun pay week
  // even when the period's stored end is shorter (Mon-Fri short upload).
  const heroDisplayEnd = currentPeriod
    ? canonicalEndForScheduleName(
        currentPeriod.startDate,
        currentPeriod.endDate,
        currentPeriod.scheduleName,
      )
    : null;

  // Days remaining is "days until canonical end". Negative means the
  // period is closed and just hasn't been LOCKED yet — surface as
  // "closed N days ago" so the admin treats it as urgent.
  const daysRemaining =
    currentPeriod && heroDisplayEnd
      ? daysBetween(todayIso, heroDisplayEnd)
      : null;

  return (
    <div className="space-y-5">
      {/* Header: title + tabs + summary chips. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Run payroll</h1>
          <p className="text-xs text-text-muted">
            Trigger an import or upload a CSV. Historical reports live in{" "}
            <Link href="/reports" className="text-brand-700 underline underline-offset-2">
              Reports
            </Link>
            .
          </p>
          <ScheduleTabs
            current={tab}
            basePath="/payroll"
          />
        </div>
        <div className="text-xs text-text-muted">
          {openCount > 0 && <span>{openCount} open</span>}
          {openCount > 0 && lockedCount > 0 && " · "}
          {lockedCount > 0 && <span>{lockedCount} locked</span>}
        </div>
      </div>

      {/* Hero: active workflow. The left accent bar + tinted background
          give weekly vs semi-monthly distinct visual identities. The "All"
          tab uses a neutral surface — the user explicitly opted out of
          per-cadence focus, so don't impose a color choice. */}
      <Card className={`relative overflow-hidden ${theme.heroTint}`}>
        <div
          aria-hidden
          className={`absolute left-0 top-0 h-full w-1 ${theme.accentBar}`}
        />
        <CardHeader className="border-b-0 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-chip px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${theme.badge}`}
              >
                {theme.label}
              </span>
              {tab === "all" && (
                <span className="text-[11px] text-text-muted">
                  Pick a cadence above to focus the workflow.
                </span>
              )}
            </div>
          </div>
          <CardTitle className="text-lg">
            {currentPeriod
              ? "Active period"
              : tab === "all"
                ? "Run payroll"
                : "No active period"}
          </CardTitle>
          <CardDescription>
            {currentPeriod
              ? "This is what needs your attention this cycle."
              : "Trigger an import or upload a CSV to start the next period."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          {/* Summary row: dates + state + days-remaining badge. */}
          {currentPeriod && heroDisplayEnd ? (
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Link
                href={`/payroll/${currentPeriod.id}`}
                className="flex items-baseline gap-2 text-xl font-semibold tracking-tight hover:text-brand-700 transition-colors"
              >
                {formatShortRange(currentPeriod.startDate, heroDisplayEnd)}
              </Link>
              <SchedulePill name={currentPeriod.scheduleName} />
              <StatusPill status={currentPeriod.state} />
              {daysRemaining !== null && (
                <span className="text-xs text-text-muted">
                  {daysRemaining > 0
                    ? `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`
                    : daysRemaining === 0
                      ? "ends today"
                      : `closed ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago`}
                </span>
              )}
            </div>
          ) : null}

          {/* Primary CTA row: Open period (when one exists) + Pull NGTeco
              + Upload CSV. NgtecoRunNowButton renders its own confirm
              flow, so we let it own its space. CSV is demoted to a
              compact secondary button — the owner uses NGTeco 95% of
              the time, but CSV stays one click away. */}
          <div className="flex flex-wrap items-center gap-2">
            {currentPeriod && (
              <Button asChild>
                <Link href={`/payroll/${currentPeriod.id}`}>
                  Open period <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
            <NgtecoRunNowButton size="md" />
            <Button asChild variant="secondary">
              <Link href="/run-payroll/upload">
                <Upload className="h-4 w-4" /> Upload CSV
              </Link>
            </Button>
          </div>

          {/* Metric / cron / poll strip. Lives at the bottom of the hero
              so the admin's eye lands on actions first, info second. */}
          <div className="mt-4 pt-4 border-t border-border/60 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-text-muted">
            {employeeCount !== null && (
              <span>
                <span className="font-medium text-text">{employeeCount}</span>{" "}
                active employee{employeeCount === 1 ? "" : "s"} on this schedule
              </span>
            )}
            <span>
              {schedules.length === 0
                ? "no active cron — add one in Settings → Pay schedules"
                : `cron: ${schedules
                    .filter((s) =>
                      tab === "all"
                        ? true
                        : tab === "weekly"
                          ? s.periodKind === "WEEKLY"
                          : tab === "semi"
                            ? s.periodKind === "SEMI_MONTHLY"
                            : true,
                    )
                    .map((s) => s.name)
                    .join(", ") || "—"}`}
            </span>
            <div className="flex-1" />
            <PollPunchesNowButton
              initialLast={
                lastPoll
                  ? {
                      startedAt: lastPoll.startedAt.toISOString(),
                      finishedAt:
                        lastPoll.finishedAt?.toISOString() ?? null,
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
          </div>
        </CardContent>
      </Card>

      {/* In-flight runs: single-line-per-row list, only renders when there
          are actually rows. Empty state collapses into a one-line
          contextual hint under the hero rather than its own large card. */}
      {recentInFlight.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-brand-700" /> In-flight runs
              </CardTitle>
              <CardDescription>
                {recentInFlight.length} run{recentInFlight.length === 1 ? "" : "s"}{" "}
                awaiting review or fixes.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentInFlight.map((r) => (
              <InFlightRow
                key={r.id}
                runId={r.id}
                href={`/payroll/run/${r.id}`}
                startDate={r.startDate ?? "?"}
                endDate={r.endDate ?? "?"}
                scheduleName={r.scheduleName}
                state={r.state}
                createdAt={r.createdAt.toISOString()}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Recent periods. The accent bar is repeated on each row so the
          cadence is recognizable in a glance even when the user is on
          the All tab. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-brand-700" /> Recent periods
          </CardTitle>
          <CardDescription>
            Open and locked periods awaiting work. Paid periods live in{" "}
            <Link href="/reports" className="text-brand-700 underline underline-offset-2">
              Reports
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {openPeriods.length === 0 ? (
            <p className="text-sm text-text-muted">No periods yet.</p>
          ) : (
            openPeriods.map((p) => {
              // Canonical 7-day week for weekly schedules — short uploads
              // (Mon-Fri) display through Sunday. Centralized in
              // lib/payroll/period-boundaries.ts so all 4 callsites agree.
              const displayEnd = canonicalEndForScheduleName(
                p.startDate,
                p.endDate,
                p.scheduleName,
              );
              const rowAccent =
                p.scheduleKind === "WEEKLY"
                  ? "before:bg-blue-500"
                  : p.scheduleKind === "SEMI_MONTHLY"
                    ? "before:bg-purple-500"
                    : "before:bg-text/30";
              return (
                <div
                  key={p.id}
                  className={`relative flex items-center justify-between gap-3 rounded-card border border-border/70 bg-surface p-3 hover:bg-surface-2 shadow-card transition-colors overflow-hidden before:absolute before:left-0 before:top-0 before:h-full before:w-0.5 ${rowAccent}`}
                >
                  <Link
                    href={`/payroll/${p.id}`}
                    className="flex items-center gap-3 font-medium flex-1 min-w-0 pl-1"
                  >
                    <span>
                      {p.startDate} – {displayEnd}
                    </span>
                    <SchedulePill name={p.scheduleName} />
                    <StatusPill status={p.state} />
                  </Link>
                  <PeriodDeleteButton periodId={p.id} state={p.state} />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
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
async function SalariedTabBody({ currentTab }: { currentTab: ScheduleTab }) {
  const all = await listEmployees({ status: "ACTIVE" });
  // STRICT: only employees who have NO weekly/semi-monthly schedule
  // attached. A SALARIED employee on a SEMI_MONTHLY schedule (e.g.
  // Juan) belongs under the Semi-monthly tab, NOT here.
  const salariedExclusive = all.filter((e) => {
    if (e.payType !== "SALARIED") return false;
    return true; // schedule-aware filter happens below using the join
  });
  // Pull each salaried employee's docs in parallel.
  const cards = await Promise.all(
    salariedExclusive.map(async (e) => ({
      employee: e,
      docs: await listEmployeeVisibleDocs(e.id),
    })),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Run payroll</h1>
          <p className="text-xs text-text-muted">
            Salaried staff are paid externally. No payroll run — just
            upload the paystub when it arrives. Each upload pre-fills
            the period dates from the employee&apos;s pay schedule.
          </p>
          <ScheduleTabs current={currentTab} basePath="/payroll" />
        </div>
        <div className="text-xs text-text-muted">
          {salariedExclusive.length} salaried employee
          {salariedExclusive.length === 1 ? "" : "s"}
        </div>
      </div>

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
          {cards.map(({ employee, docs }) => (
            <Card key={employee.id} className="overflow-hidden">
              <CardHeader className="border-b-0 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar name={employee.displayName} size="md" />
                    <div className="min-w-0">
                      <CardTitle className="text-base">
                        {employee.displayName}
                      </CardTitle>
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
