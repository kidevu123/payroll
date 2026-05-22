import Link from "next/link";
import { CalendarDays, MessageSquareWarning } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";
import { StatusPill } from "@/components/domain/status-pill";
import { SchedulePill } from "@/components/domain/schedule-pill";
import { PayrollRunCard } from "@/components/domain/payroll-run-card";
import { StatStrip } from "@/components/domain/stat-strip";
import { AttendancePanel } from "@/components/domain/attendance-panel";
import { listEmployees } from "@/lib/db/queries/employees";
import { listTodayPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import {
  getCurrentPeriod,
  getMostRecentPeriod,
} from "@/lib/db/queries/pay-periods";
import { getCurrentRun, listRuns } from "@/lib/db/queries/payroll-runs";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
import { listApprovedTimeOffForDate } from "@/lib/db/queries/time-off";
import { getLastSuccessfulPoll } from "@/lib/db/queries/poll-history";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { formatTimeShort } from "@/lib/utils";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function todayInTz(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** "May 22" style label for the attendance panel header. */
function shortDateLabel(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, m - 1, d)));
}

export default async function DashboardPage() {
  const company = await getSetting("company");
  const today = todayInTz(company.timezone);

  const period =
    (await getCurrentPeriod(today)) ?? (await getMostRecentPeriod());
  const run = await getCurrentRun();

  const [
    employees,
    pendingMissed,
    pendingTimeOff,
    todayPunches,
    approvedOffToday,
    lastPoll,
  ] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    listPendingMissedPunchRequests(),
    listPendingTimeOffRequests(),
    listTodayPunches(today, company.timezone),
    listApprovedTimeOffForDate(today),
    getLastSuccessfulPoll(),
  ]);

  const pendingTotal = pendingMissed.length + pendingTimeOff.length;

  // ── Period stats ─────────────────────────────────────────────────────────
  // Computed whenever a period exists, regardless of run state. This ensures
  // the PayrollRunCard and StatStrip always show live data on non-Sunday days.
  let stats:
    | {
        hours: number;
        gross: number;
        rounded: number;
        employeeCount: number;
        unresolvedAlerts: number;
      }
    | undefined;
  if (period) {
    const [periodPunches, payRules, alerts] = await Promise.all([
      import("@/lib/db/queries/punches").then((m) =>
        m.listPunches({ periodId: period.id }),
      ),
      getSetting("payRules"),
      listAlertsForPeriod(period.id, { unresolvedOnly: true }),
    ]);
    const tasks = await db
      .select()
      .from(taskPayLineItems)
      .where(eq(taskPayLineItems.periodId, period.id));
    const { tempWorkerEntries } = await import("@/lib/db/schema");
    const tempWorkers = await db
      .select()
      .from(tempWorkerEntries)
      .where(eq(tempWorkerEntries.periodId, period.id));

    const punchesByE = new Map<string, typeof periodPunches>();
    for (const p of periodPunches) {
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

    let totals = { hours: 0, gross: 0, rounded: 0 };
    let activeWithWork = 0;

    for (const e of employees) {
      const ePunches = punchesByE.get(e.id) ?? [];
      const eTasks = tasksByE.get(e.id) ?? [];
      if (ePunches.length === 0 && eTasks.length === 0) continue;
      const rates = await listRates(e.id);
      const result = computePay({
        punches: ePunches,
        rateAt: (p) => {
          const day = (
            p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn)
          )
            .toISOString()
            .slice(0, 10);
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
      totals.hours += result.totalHours;
      totals.gross += result.grossCents;
      totals.rounded += result.roundedCents;
      activeWithWork++;
    }

    for (const tw of tempWorkers) {
      totals.gross += tw.amountCents;
      totals.rounded += tw.amountCents;
      if (tw.hours !== null) totals.hours += Number(tw.hours);
      activeWithWork += 1;
    }

    stats = {
      ...totals,
      employeeCount: activeWithWork,
      unresolvedAlerts: alerts.length,
    };
  }

  // ── Attendance panel buckets ──────────────────────────────────────────────
  const punchedEmpIds = new Set(todayPunches.map((p) => p.employeeId));
  const firstPunchByEmp = new Map<string, Date>();
  for (const p of todayPunches) {
    const existing = firstPunchByEmp.get(p.employeeId);
    if (!existing || p.clockIn < existing) {
      firstPunchByEmp.set(p.employeeId, p.clockIn);
    }
  }
  const approvedOffEmpIds = new Set(approvedOffToday.map((r) => r.employeeId));

  const punchedList = employees
    .filter((e) => punchedEmpIds.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.displayName,
      firstPunchAt: formatTimeShort(
        firstPunchByEmp.get(e.id)!,
        company.timezone,
      ),
    }));

  const approvedOutList = employees
    .filter((e) => !punchedEmpIds.has(e.id) && approvedOffEmpIds.has(e.id))
    .map((e) => {
      const req = approvedOffToday.find((r) => r.employeeId === e.id);
      return { id: e.id, name: e.displayName, type: req?.type ?? "UNPAID" };
    });

  const noPunchList = employees
    .filter((e) => !punchedEmpIds.has(e.id) && !approvedOffEmpIds.has(e.id))
    .map((e) => ({ id: e.id, name: e.displayName }));

  // ── Recent runs ───────────────────────────────────────────────────────────
  const rawRecent = await listRuns(5);
  const periodIds = Array.from(new Set(rawRecent.map((r) => r.periodId)));
  const scheduleIds = Array.from(
    new Set(
      rawRecent
        .map((r) => r.payScheduleId)
        .filter((s): s is string => Boolean(s)),
    ),
  );
  const { payPeriods: periodsTable, paySchedules: schedulesTable } =
    await import("@/lib/db/schema");
  const { inArray } = await import("drizzle-orm");
  const [periodRows, scheduleRows] = await Promise.all([
    periodIds.length
      ? db.select().from(periodsTable).where(inArray(periodsTable.id, periodIds))
      : [],
    scheduleIds.length
      ? db
          .select()
          .from(schedulesTable)
          .where(inArray(schedulesTable.id, scheduleIds))
      : [],
  ]);
  const periodById = new Map(periodRows.map((p) => [p.id, p]));
  const scheduleById = new Map(scheduleRows.map((s) => [s.id, s]));
  const recentRuns = rawRecent.map((r) => ({
    ...r,
    period: periodById.get(r.periodId) ?? null,
    schedule: r.payScheduleId
      ? (scheduleById.get(r.payScheduleId) ?? null)
      : null,
  }));

  const cardState: Parameters<typeof PayrollRunCard>[0]["state"] = run
    ? run.state
    : "NO_RUN";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-text-muted">
          {period
            ? `Period ${period.startDate} – ${period.endDate}`
            : "No active period"}
        </p>
      </header>

      <StatStrip
        inToday={punchedList.length}
        totalActive={employees.length}
        exceptions={stats?.unresolvedAlerts ?? 0}
        lastPollAt={lastPoll?.finishedAt ?? null}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <PayrollRunCard
          state={cardState}
          {...(period
            ? { period: { startDate: period.startDate, endDate: period.endDate } }
            : {})}
          {...(run?.id ? { runId: run.id } : {})}
          {...(stats ? { stats } : {})}
          {...(run?.employeeFixDeadline
            ? {
                fixDeadline: run.employeeFixDeadline
                  .toISOString()
                  .slice(0, 16)
                  .replace("T", " "),
              }
            : {})}
        />
        <AttendancePanel
          punched={punchedList}
          approvedOut={approvedOutList}
          noPunch={noPunchList}
          todayLabel={shortDateLabel(today)}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pending requests</CardTitle>
            <CardDescription>
              {pendingTotal === 0
                ? "Nothing awaits your review."
                : `${pendingMissed.length} missed-punch · ${pendingTimeOff.length} time-off`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingTotal === 0 ? (
              <EmptyState
                icon={MessageSquareWarning}
                title="All clear"
                description="No employee submissions waiting on a decision."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/requests">Open requests page</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2">
                {pendingMissed.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    href="/requests"
                    className="block rounded-card border border-border bg-surface-2 p-3 hover:bg-surface-3 shadow-sm"
                  >
                    <div className="text-sm font-medium">
                      Missed punch · {r.date}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {r.reason}
                    </div>
                  </Link>
                ))}
                {pendingTimeOff.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    href="/requests"
                    className="block rounded-card border border-border bg-surface-2 p-3 hover:bg-surface-3 shadow-sm"
                  >
                    <div className="text-sm font-medium">
                      Time off · {r.startDate} – {r.endDate} (
                      {r.type.toLowerCase()})
                    </div>
                    {r.reason && (
                      <div className="text-xs text-text-muted truncate">
                        {r.reason}
                      </div>
                    )}
                  </Link>
                ))}
                {pendingTotal > 6 && (
                  <Button asChild variant="ghost" size="sm" className="mt-2">
                    <Link href="/requests">View all {pendingTotal}</Link>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No runs yet"
                description="The first run kicks off on the configured cron."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {recentRuns.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={
                        r.period
                          ? `/payroll/${r.period.id}`
                          : `/payroll/run/${r.id}`
                      }
                      className="flex items-center justify-between gap-3 rounded-input border border-border px-3 py-2 hover:bg-surface-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">
                            {r.period
                              ? `${r.period.startDate} – ${r.period.endDate}`
                              : `run ${r.id.slice(0, 8)}`}
                          </span>
                          <SchedulePill name={r.schedule?.name ?? null} />
                        </div>
                        {r.totalAmountCents !== null && (
                          <div className="text-xs text-text-muted truncate">
                            <MoneyDisplay
                              cents={r.totalAmountCents}
                              monospace={false}
                            />
                          </div>
                        )}
                      </div>
                      <StatusPill status={r.state as never} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
