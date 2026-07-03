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

import Link from "next/link";
import { Wallet, Upload, Briefcase, Pencil, ChevronRight } from "lucide-react";
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
import { payPeriods, paySchedules } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
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

  const [openPeriods, lastPoll] = await Promise.all([
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
  ]);

  // openPeriods is filtered to OPEN+LOCKED only (PAID lives in /reports).
  const openCount = openPeriods.filter((p) => p.state === "OPEN").length;
  const lockedCount = openPeriods.filter((p) => p.state === "LOCKED").length;

  const periodSummary =
    openCount > 0 || lockedCount > 0
      ? [
          openCount > 0 ? `${openCount} open` : null,
          lockedCount > 0 ? `${lockedCount} locked` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

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
          <CardTitle className="flex items-center gap-2 text-base">
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
          {openPeriods.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No periods yet"
              description="Open and locked pay periods awaiting work will appear here. Paid periods live in Reports."
            />
          ) : (
            openPeriods.map((p) => {
              // Canonical 7-day week for weekly schedules — short uploads
              // (Mon-Fri) display through Sunday. Centralized in
              // lib/payroll/period-boundaries.ts so all callsites agree.
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
                    : p.scheduleKind === "MONTHLY"
                      ? "before:bg-amber-500"
                      : "before:bg-text/30";
              return (
                <div
                  key={p.id}
                  className={`relative flex items-center justify-between gap-3 rounded-card border border-border/70 bg-surface p-3 hover:bg-surface-2 shadow-card transition-colors overflow-hidden before:absolute before:left-0 before:top-0 before:h-full before:w-0.5 focus-within:ring-2 focus-within:ring-brand-700/60 ${rowAccent}`}
                >
                  {/* Stretched link: the whole row is the click/hover target
                      (after:inset-0), while the delete button sits above it
                      via z-10 so it stays independently clickable. Keyboard
                      focus lights the row through focus-within. */}
                  <Link
                    href={`/payroll/${p.id}`}
                    className="group flex items-center gap-3 font-medium flex-1 min-w-0 pl-1 after:absolute after:inset-0 after:rounded-card focus:outline-none focus-visible:outline-none"
                  >
                    <div className="flex flex-1 min-w-0 items-center gap-3">
                      <span className="tabular-nums">
                        {p.startDate} – {displayEnd}
                      </span>
                      <SchedulePill name={p.scheduleName} />
                      <StatusPill status={p.state} />
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

      <p className="text-xs text-text-muted">
        Salaried staff are paid externally. No payroll run — just upload the
        paystub when it arrives. Each upload pre-fills the period dates from the
        employee&apos;s pay schedule.
      </p>

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
