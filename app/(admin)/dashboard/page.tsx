// Premium dark "wow" dashboard — the showcase screen.
//
// Self-contained dark canvas: the rest of the app is light, so this page
// wraps everything in a deep near-black container with explicit dark surface
// styling. It does NOT enable global dark mode or touch app/globals.css token
// values. All charts are client components fed serializable props from this
// RSC page.

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

  // Avatar URL only when the employee actually has a photo (else null →
  // initials fallback, never a broken image).
  const photoUrlFor = (emp: { id: string; photoPath: string | null }): string | null =>
    emp.photoPath ? `/api/employees/${emp.id}/photo?v=${emp.id.slice(0, 8)}` : null;
  const empById = new Map(employees.map((e) => [e.id, e]));

  const todayBuckets: TodayBuckets = {
    punched: employees
      .filter((e) => punchedEmpIds.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.displayName,
        firstPunchAt: formatTimeShort(firstPunchByEmp.get(e.id)!, company.timezone),
        photoUrl: photoUrlFor(e),
      })),
    approvedOut: employees
      .filter((e) => !punchedEmpIds.has(e.id) && approvedOffEmpIds.has(e.id))
      .map((e) => {
        const req = approvedOffToday.find((r) => r.employeeId === e.id);
        return { id: e.id, name: e.displayName, type: req?.type ?? "UNPAID", photoUrl: photoUrlFor(e) };
      }),
    noPunch: employees
      .filter((e) => !punchedEmpIds.has(e.id) && !approvedOffEmpIds.has(e.id))
      .map((e) => ({ id: e.id, name: e.displayName, photoUrl: photoUrlFor(e) })),
    label: shortDateLabel(today),
  };

  // ── Pending request items (with requester name + avatar) ──────────────────
  const empMeta = (
    employeeId: string,
  ): { employeeName: string; photoUrl: string | null } => {
    const emp = empById.get(employeeId);
    return emp
      ? { employeeName: emp.displayName, photoUrl: photoUrlFor(emp) }
      : { employeeName: "Employee", photoUrl: null };
  };
  const pendingItems: PendingItem[] = [
    ...pendingMissed.map((r) => ({
      id: r.id,
      kind: "MISSED_PUNCH" as const,
      ...empMeta(r.employeeId),
      title: "Missed punch",
      subtitle: r.date,
    })),
    ...pendingTimeOff.map((r) => ({
      id: r.id,
      kind: "TIME_OFF" as const,
      ...empMeta(r.employeeId),
      title: "Time off request",
      subtitle: `${r.startDate} – ${r.endDate}`,
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

  // Greeting name: prefer the linked employee's real display name, fall back
  // to the email-derived name. First token only ("Nabeel Vira" → "Nabeel").
  const meEmp = session.user.employeeId
    ? employees.find((e) => e.id === session.user.employeeId) ?? null
    : null;
  const firstName = (meEmp?.displayName ?? metrics.greetingName).split(/\s+/)[0] ?? metrics.greetingName;

  return (
    // The dark shell (layout) owns the canvas background + container; the page
    // just lays out its content sections. Tight vertical rhythm so the whole
    // dashboard reads as one composed screen (matches the reference density).
    <div className="space-y-2">
      <GreetingHeader
        name={firstName}
        hour={hour}
        todayLabel={metrics.todayLongLabel ?? shortDateLabel(today)}
        compareLabel={metrics.trend.compareLabel ?? null}
        quickActionHref={quickActionHref}
        quickActionLabel={quickActionLabel}
      />

      {/* TOP ROW — cadence cards (equal height) */}
      <section className="grid items-stretch gap-2 md:grid-cols-2 xl:grid-cols-3">
        {metrics.cadences.map((card) => (
          <CadenceCard key={card.scheduleId} card={card} />
        ))}
      </section>

      {/* SECOND ROW — trend + mini stats + sync + health, all equal height */}
      <section className="grid items-stretch gap-2 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <TrendCard trend={metrics.trend} />
        </div>
        <div className="flex flex-col gap-2 lg:col-span-4">
          <div className="grid grid-cols-2 gap-2">
            <HeadcountCard count={metrics.headcount} delta={metrics.headcountDelta} />
            <ExceptionsCard count={metrics.exceptions} />
          </div>
          <div className="flex-1">
            <SyncCard sync={metrics.sync} />
          </div>
        </div>
        <div className="lg:col-span-3">
          <HealthCard health={metrics.health} />
        </div>
      </section>

      {/* Automate-more banner + two real stat cards */}
      <AutomationBanner automation={metrics.automation} />

      {/* THIRD ROW — pending / recent / today (equal height) */}
      <section className="grid items-stretch gap-2 lg:grid-cols-3">
        <PendingRequestsCard items={pendingItems} />
        <RecentRunsCard items={recentRuns} />
        <TodayCard buckets={todayBuckets} />
      </section>

      {/* BOTTOM — full-width KPI bar */}
      <KpiBar kpis={metrics.kpis} />
    </div>
  );
}
