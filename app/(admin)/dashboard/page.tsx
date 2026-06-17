// Premium dark "wow" dashboard — the showcase screen.
//
// Self-contained dark canvas: the rest of the app is light, so this page
// wraps everything in a deep near-black container with explicit dark surface
// styling. It does NOT enable global dark mode or touch app/globals.css token
// values. All charts are client components fed serializable props from this
// RSC page.

import Link from "next/link";
import { PollPunchesNowButton } from "@/components/admin/poll-punches-now";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { CadenceCard } from "@/components/dashboard/cadence-card";
import {
  TrendCard,
  HeadcountCard,
  ExceptionsCard,
  SyncCard,
  HealthCard,
  AutomationBanner,
  KpiBar,
} from "@/components/dashboard/insight-cards";
import {
  PendingRequestsCard,
  RecentRunsCard,
  TodayCard,
  type PendingItem,
  type RecentRunItem,
  type TodayBuckets,
} from "@/components/dashboard/activity-cards";
import { DASH } from "@/components/dashboard/theme";
import { computeDashboardMetrics } from "@/lib/payroll/dashboard-metrics";
import { listEmployees } from "@/lib/db/queries/employees";
import { listTodayPunches } from "@/lib/db/queries/punches";
import { listRuns } from "@/lib/db/queries/payroll-runs";
import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
import { listApprovedTimeOffForDate } from "@/lib/db/queries/time-off";
import { getSetting } from "@/lib/settings/runtime";
import { requireSession } from "@/lib/auth-guards";
import { formatTimeShort } from "@/lib/utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

function hourInTz(tz: string): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  return Number(h) % 24;
}

function shortDateLabel(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, m - 1, d)));
}

export default async function DashboardPage() {
  const session = await requireSession();
  const company = await getSetting("company");
  const today = todayInTz(company.timezone);
  const hour = hourInTz(company.timezone);

  const [
    metrics,
    employees,
    todayPunches,
    approvedOffToday,
    pendingMissed,
    pendingTimeOff,
    rawRecent,
  ] = await Promise.all([
    computeDashboardMetrics({ today, sessionEmail: session.user.email ?? null }),
    listEmployees({ status: "ACTIVE" }),
    listTodayPunches(today, company.timezone),
    listApprovedTimeOffForDate(today),
    listPendingMissedPunchRequests(),
    listPendingTimeOffRequests(),
    listRuns(5),
  ]);

  // ── Attendance buckets (same logic as the prior dashboard) ────────────────
  const punchedEmpIds = new Set(todayPunches.map((p) => p.employeeId));
  const firstPunchByEmp = new Map<string, Date>();
  for (const p of todayPunches) {
    const existing = firstPunchByEmp.get(p.employeeId);
    if (!existing || p.clockIn < existing) {
      firstPunchByEmp.set(p.employeeId, p.clockIn);
    }
  }
  const approvedOffEmpIds = new Set(approvedOffToday.map((r) => r.employeeId));

  const todayBuckets: TodayBuckets = {
    punched: employees
      .filter((e) => punchedEmpIds.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.displayName,
        firstPunchAt: formatTimeShort(firstPunchByEmp.get(e.id)!, company.timezone),
      })),
    approvedOut: employees
      .filter((e) => !punchedEmpIds.has(e.id) && approvedOffEmpIds.has(e.id))
      .map((e) => {
        const req = approvedOffToday.find((r) => r.employeeId === e.id);
        return { id: e.id, name: e.displayName, type: req?.type ?? "UNPAID" };
      }),
    noPunch: employees
      .filter((e) => !punchedEmpIds.has(e.id) && !approvedOffEmpIds.has(e.id))
      .map((e) => ({ id: e.id, name: e.displayName })),
    label: shortDateLabel(today),
  };

  // ── Pending request items ─────────────────────────────────────────────────
  const pendingItems: PendingItem[] = [
    ...pendingMissed.map((r) => ({
      id: r.id,
      kind: "MISSED_PUNCH" as const,
      title: `Missed punch · ${r.date}`,
      subtitle: r.reason,
    })),
    ...pendingTimeOff.map((r) => ({
      id: r.id,
      kind: "TIME_OFF" as const,
      title: `Time off · ${r.startDate} – ${r.endDate}`,
      subtitle: r.reason ?? r.type.toLowerCase(),
    })),
  ];

  // ── Recent runs ───────────────────────────────────────────────────────────
  const periodIds = Array.from(new Set(rawRecent.map((r) => r.periodId)));
  const scheduleIds = Array.from(
    new Set(
      rawRecent.map((r) => r.payScheduleId).filter((s): s is string => Boolean(s)),
    ),
  );
  const { payPeriods: periodsTable, paySchedules: schedulesTable } = await import(
    "@/lib/db/schema"
  );
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
  const recentRuns: RecentRunItem[] = rawRecent.map((r) => {
    const period = periodById.get(r.periodId) ?? null;
    const schedule = r.payScheduleId
      ? (scheduleById.get(r.payScheduleId) ?? null)
      : null;
    return {
      id: r.id,
      href: period ? `/payroll/${period.id}` : `/payroll/run/${r.id}`,
      label: period
        ? `${period.startDate} – ${period.endDate}`
        : `Run ${r.id.slice(0, 8)}`,
      scheduleName: schedule?.name ?? null,
      amountCents: r.totalAmountCents,
      state: r.state,
    };
  });

  // ── Quick action: point at the most urgent cadence's next step ────────────
  const urgent =
    metrics.cadences.find((c) =>
      ["AWAITING_ADMIN_REVIEW", "AWAITING_EMPLOYEE_FIXES", "APPROVED"].includes(
        c.runState ?? "",
      ),
    ) ?? metrics.cadences.find((c) => c.period && c.period.state !== "PAID");
  const quickActionHref = urgent?.period
    ? urgent.runId
      ? `/payroll/run/${urgent.runId}`
      : `/payroll/${urgent.period.id}`
    : "/payroll";
  const quickActionLabel = urgent ? "Quick action" : "Go to payroll";

  return (
    <div
      className="-mx-4 -my-4 min-h-screen px-4 py-6 sm:-mx-6 sm:-my-6 sm:px-6 sm:py-8"
      style={{
        background: `radial-gradient(1200px 600px at 80% -10%, rgba(139,92,246,0.10), transparent 60%), ${DASH.bg}`,
        color: DASH.text,
      }}
    >
      <div className="mx-auto max-w-[1400px] space-y-6">
        <GreetingHeader
          name={metrics.greetingName}
          hour={hour}
          todayLabel={shortDateLabel(today)}
          quickActionHref={quickActionHref}
          quickActionLabel={quickActionLabel}
        />

        {/* TOP ROW — cadence cards */}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {metrics.cadences.map((card) => (
            <CadenceCard key={card.scheduleId} card={card} />
          ))}
        </section>

        {/* SECOND ROW — trend + mini stats + sync + health */}
        <section className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5 xl:col-span-6">
            <TrendCard trend={metrics.trend} />
          </div>
          <div className="grid grid-cols-2 gap-4 lg:col-span-4 xl:col-span-3">
            <HeadcountCard count={metrics.headcount} />
            <ExceptionsCard count={metrics.exceptions} />
            <div className="col-span-2">
              <SyncCard sync={metrics.sync} />
            </div>
          </div>
          <div className="lg:col-span-3">
            <HealthCard health={metrics.health} />
          </div>
        </section>

        {/* Automate-more banner + two real stat cards */}
        <AutomationBanner automation={metrics.automation} />

        {/* Sync punches affordance (preserved real action) */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
          style={{ background: DASH.surface, border: `1px solid ${DASH.border}` }}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: DASH.text }}>
              Sync punches from NGTeco
            </div>
            <div className="text-[12px]" style={{ color: DASH.textMuted }}>
              Pulls every punch and files it to the right period and employee
              automatically.
            </div>
          </div>
          <PollPunchesNowButton initialLast={null} />
        </div>

        {/* THIRD ROW — pending / recent / today */}
        <section className="grid gap-4 lg:grid-cols-3">
          <PendingRequestsCard items={pendingItems} />
          <RecentRunsCard items={recentRuns} />
          <TodayCard buckets={todayBuckets} />
        </section>

        {/* BOTTOM — KPI bar */}
        <KpiBar kpis={metrics.kpis} />

        <div className="pt-2 text-center text-[11px]" style={{ color: DASH.textFaint }}>
          <Link href="/reports" style={{ color: DASH.textMuted }}>
            View full reports →
          </Link>
        </div>
      </div>
    </div>
  );
}
