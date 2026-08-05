// Server-side aggregation for the premium dark dashboard.
//
// One entry point — `computeDashboardMetrics(today)` — that fans out to the
// EXISTING query/report helpers in parallel and shapes their output into
// serializable props the RSC dashboard page hands to its client chart cards.
//
// Design rules honoured here:
//   • Money stays integer cents end-to-end. Display layers format.
//   • Every number traces back to a real query (see the per-field comments).
//     Nothing is faked; a metric we can't back with data is simply omitted
//     rather than invented.
//   • Reads only. No mutations, no audit rows.

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payslips, payPeriods } from "@/lib/db/schema";
import { computeScheduleCockpit, type CockpitRow } from "./schedule-cockpit";
import { getYtd } from "@/lib/reports/ytd";
import { listRuns } from "@/lib/db/queries/payroll-runs";
import { listEmployees } from "@/lib/db/queries/employees";
import {
  getLastPoll,
  listRecentPolls,
} from "@/lib/db/queries/poll-history";
import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
import { getSetting } from "@/lib/settings/runtime";
import { addDaysIso } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Serializable output shapes (all consumed by "use client" chart components)
// ─────────────────────────────────────────────────────────────────────────────

export type SparkPoint = {
  /** "May 18 – May 24" label for tooltips. */
  label: string;
  /** Period rounded total, integer cents. */
  cents: number;
};

export type CadenceCard = {
  scheduleId: string;
  scheduleName: string;
  periodKind: string;
  period: CockpitRow["period"];
  employeeCount: number;
  hours: number;
  /** Current open period's rounded total, integer cents. */
  totalCents: number;
  /** % change vs the immediately-prior period for this cadence; null if no prior. */
  deltaPct: number | null;
  unresolvedAlerts: number;
  runId: string | null;
  runState: string | null;
  /** Range label of the prior period the delta compares against, e.g.
   *  "May 26 – Jun 25"; null when there is no prior period. */
  priorRangeLabel: string | null;
  /** Recent historical period totals for this cadence (oldest → newest). */
  spark: SparkPoint[];
};

export type TrendPoint = {
  /** "Jan", "Feb", … */
  month: string;
  /** Total rounded payroll spend that month, integer cents. */
  cents: number;
};

export type SyncPoint = {
  /** Epoch ms of poll start — used only for ordering/keys. */
  t: number;
  /** Pairs inserted+updated on that poll (a proxy for "did work flow"). */
  value: number;
  ok: boolean;
};

export type HealthChecklistItem = {
  key: "exceptions" | "onTime" | "sync" | "approvals";
  label: string;
  ok: boolean;
};

export type DashboardMetrics = {
  greetingName: string;
  /** "June 16, 2026" — long date for the greeting header date pill. */
  todayLongLabel: string;
  cadences: CadenceCard[];
  trend: {
    points: TrendPoint[];
    ytdCents: number;
    /** % change of latest month vs prior month with data; null if <2 months. */
    deltaPct: number | null;
    /** "Compared to Jun 9 – Jun 15, 2026" — prior 7-day window vs today. */
    compareLabel: string;
  };
  headcount: number;
  /** Net change in active headcount vs ~30 days ago; null when unknown. */
  headcountDelta: number | null;
  exceptions: number;
  sync: {
    state: "STABLE" | "STALE" | "UNKNOWN";
    lastSyncAt: string | null; // ISO
    points: SyncPoint[];
  };
  health: {
    score: number; // 0–100
    checklist: HealthChecklistItem[];
  };
  kpis: {
    ytdSpendCents: number;
    costPerEmployeeCents: number | null;
    runsThisMonth: number;
    activeEmployees: number;
    /** Estimated spend over the next 4 weeks: YTD run-rate × 4 weeks. */
    projectedSpendCents: number;
  };
  automation: {
    runsThisMonth: number;
    openPeriods: number;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "STALE" if the last successful sync is older than this. */
const SYNC_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours

/** How many trailing periods feed a cadence sparkline. */
const SPARK_WINDOW = 8;

/** Friendly first name from an email local-part, else fall back. */
function nameFromEmail(email: string | null | undefined, fallback: string): string {
  if (!email) return fallback;
  const local = email.split("@")[0] ?? "";
  const token = local.split(/[.\-_+]/)[0] ?? "";
  if (!token) return fallback;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function pctDelta(latest: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((latest - prior) / prior) * 100;
}

function shortRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number) as [number, number, number];
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2000, m - 1, d)));
  };
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

/** "June 16, 2026" from an ISO date string. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** ISO date `n` days before the given ISO date (UTC math). */

/** "Compared to Jun 9 – Jun 15, 2026" — the 7-day window ending yesterday. */
function priorWeekCompareLabel(todayIso: string): string {
  const end = addDaysIso(todayIso, -1);
  const start = addDaysIso(todayIso, -7);
  const year = end.slice(0, 4);
  return `Compared to ${shortRange(start, end)}, ${year}`;
}

/**
 * Per-period rounded totals WITH the owning pay schedule, newest first.
 * Derived from the same payslips→pay_periods join that period-totals.ts uses,
 * but carrying pay_schedule_id so totals can be bucketed per cadence for the
 * sparklines. Only non-voided payslips count (matches getPeriodTotals).
 */
type PeriodScheduleTotal = {
  periodId: string;
  payScheduleId: string | null;
  startDate: string;
  endDate: string;
  roundedCents: number;
};

async function getPeriodTotalsBySchedule(
  fromIso: string,
): Promise<PeriodScheduleTotal[]> {
  const rows = await db
    .select({
      periodId: payslips.periodId,
      payScheduleId: payPeriods.payScheduleId,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      rounded: sql<number>`COALESCE(SUM(${payslips.roundedPayCents}), 0)::int`,
    })
    .from(payslips)
    .innerJoin(payPeriods, eq(payslips.periodId, payPeriods.id))
    .where(and(isNull(payslips.voidedAt), gte(payPeriods.startDate, fromIso)))
    .groupBy(
      payslips.periodId,
      payPeriods.payScheduleId,
      payPeriods.startDate,
      payPeriods.endDate,
    );

  return rows
    .map((r) => ({
      periodId: r.periodId,
      payScheduleId: r.payScheduleId,
      startDate: r.startDate,
      endDate: r.endDate,
      roundedCents: r.rounded,
    }))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)); // newest first
}

// ─────────────────────────────────────────────────────────────────────────────
// Main aggregation
// ─────────────────────────────────────────────────────────────────────────────

export async function computeDashboardMetrics(args: {
  today: string;
  sessionEmail: string | null;
}): Promise<DashboardMetrics> {
  const { today, sessionEmail } = args;
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const monthPrefix = today.slice(0, 7); // YYYY-MM

  // Window for cadence sparklines / trend: trailing ~14 months so an 8-period
  // weekly sparkline and a 12-month trend both have enough history.
  const sparkFromIso = `${year - 1}-01-01`;

  const [
    company,
    cockpitRows,
    ytdRows,
    runs,
    employees,
    lastPoll,
    recentPolls,
    pendingMissed,
    pendingTimeOff,
    periodScheduleTotals,
    openPeriodRows,
  ] = await Promise.all([
    getSetting("company"),
    computeScheduleCockpit(today),
    getYtd(year),
    listRuns(40),
    listEmployees({ status: "ACTIVE" }),
    getLastPoll(),
    listRecentPolls(24),
    listPendingMissedPunchRequests(),
    listPendingTimeOffRequests(),
    getPeriodTotalsBySchedule(sparkFromIso),
    db
      .select({ id: payPeriods.id })
      .from(payPeriods)
      .where(eq(payPeriods.state, "OPEN")),
  ]);

  // ── Greeting name ─────────────────────────────────────────────────────────
  const greetingName = nameFromEmail(sessionEmail, company.name);

  // ── Cadence cards (current totals from cockpit + per-cadence sparklines) ──
  const totalsBySchedule = new Map<string, PeriodScheduleTotal[]>();
  for (const t of periodScheduleTotals) {
    if (!t.payScheduleId) continue;
    const list = totalsBySchedule.get(t.payScheduleId) ?? [];
    list.push(t);
    totalsBySchedule.set(t.payScheduleId, list);
  }

  const cadences: CadenceCard[] = cockpitRows.map((row) => {
    // newest-first history for this cadence, excluding the still-open current
    // period (its number lives in the headline figure already).
    const history = (totalsBySchedule.get(row.scheduleId) ?? []).filter(
      (h) => h.periodId !== row.period?.id,
    );
    const priorPeriod = history[0] ?? null;
    const priorTotal = priorPeriod?.roundedCents ?? null;
    const priorRangeLabel = priorPeriod
      ? shortRange(priorPeriod.startDate, priorPeriod.endDate)
      : null;
    const deltaPct =
      priorTotal !== null && row.roundedCents > 0
        ? pctDelta(row.roundedCents, priorTotal)
        : null;

    // Sparkline: oldest → newest of the last SPARK_WINDOW periods, then the
    // current open period appended so the line "lands" on today's figure.
    const recent = history.slice(0, SPARK_WINDOW).reverse();
    const spark: SparkPoint[] = recent.map((h) => ({
      label: shortRange(h.startDate, h.endDate),
      cents: h.roundedCents,
    }));
    if (row.period && row.roundedCents > 0) {
      spark.push({
        label: shortRange(row.period.startDate, row.period.endDate),
        cents: row.roundedCents,
      });
    }

    return {
      scheduleId: row.scheduleId,
      scheduleName: row.scheduleName,
      periodKind: row.periodKind,
      period: row.period,
      employeeCount: row.employeeCount,
      hours: row.hours,
      totalCents: row.roundedCents,
      deltaPct,
      unresolvedAlerts: row.unresolvedAlerts,
      runId: row.runId,
      runState: row.runState,
      priorRangeLabel,
      spark,
    };
  });

  // ── Pay spend trend (monthly rounded spend, current year) ────────────────
  const monthlyCents = new Array(12).fill(0) as number[];
  for (const t of periodScheduleTotals) {
    if (t.startDate < yearStart) continue;
    const monthIdx = Number(t.startDate.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      monthlyCents[monthIdx] = (monthlyCents[monthIdx] ?? 0) + t.roundedCents;
    }
  }
  const currentMonthIdx = Number(today.slice(5, 7)) - 1;
  const trendPoints: TrendPoint[] = [];
  for (let i = 0; i <= currentMonthIdx; i++) {
    trendPoints.push({
      month: MONTH_LABELS[i] ?? "",
      cents: monthlyCents[i] ?? 0,
    });
  }
  const ytdCents = ytdRows.reduce((sum, r) => sum + r.roundedCents, 0);
  // Latest month with data vs the prior month with data.
  const monthsWithData = trendPoints.filter((p) => p.cents > 0);
  const latestMonth = monthsWithData[monthsWithData.length - 1];
  const priorMonth = monthsWithData[monthsWithData.length - 2];
  const trendDelta =
    latestMonth && priorMonth
      ? pctDelta(latestMonth.cents, priorMonth.cents)
      : null;

  // ── Headcount / exceptions ────────────────────────────────────────────────
  const headcount = employees.length;
  // Exceptions = unresolved missed-punch alerts across the cadences' open
  // periods. The cockpit already counted unresolved alerts per current
  // period; sum them (distinct periods, never double-counted).
  const exceptions = cockpitRows.reduce(
    (sum, r) => sum + r.unresolvedAlerts,
    0,
  );

  // ── NGTeco sync ───────────────────────────────────────────────────────────
  const lastSyncMs = lastPoll?.finishedAt?.getTime() ?? null;
  let syncState: "STABLE" | "STALE" | "UNKNOWN";
  if (!lastPoll || lastSyncMs === null) {
    syncState = "UNKNOWN";
  } else if (Date.now() - lastSyncMs > SYNC_STALE_MS || !lastPoll.ok) {
    syncState = "STALE";
  } else {
    syncState = "STABLE";
  }
  const syncPoints: SyncPoint[] = recentPolls
    .slice()
    .reverse() // oldest → newest
    .map((p) => ({
      t: p.startedAt.getTime(),
      value: (p.pairsInserted ?? 0) + (p.pairsUpdated ?? 0),
      ok: p.ok,
    }));

  // ── Payroll health score (honest heuristic from booleans) ────────────────
  const noExceptions = exceptions === 0;
  const syncHealthy = syncState === "STABLE";
  // On-time payroll: no cadence is sitting in a "needs review / failed" run
  // state with an open period past its window. We treat any cadence whose run
  // is in a stuck/failed state as not-on-time.
  const STUCK_STATES = new Set([
    "INGEST_FAILED",
    "FAILED",
    "AWAITING_EMPLOYEE_FIXES",
  ]);
  const onTime = !cockpitRows.some(
    (r) => r.runState !== null && STUCK_STATES.has(r.runState),
  );
  // All approvals complete: nothing pending in the request queues, and no run
  // is sitting in AWAITING_ADMIN_REVIEW.
  const approvalsComplete =
    pendingMissed.length === 0 &&
    pendingTimeOff.length === 0 &&
    !cockpitRows.some((r) => r.runState === "AWAITING_ADMIN_REVIEW");

  const checklist: HealthChecklistItem[] = [
    { key: "exceptions", label: "No exceptions", ok: noExceptions },
    { key: "onTime", label: "On-time payroll", ok: onTime },
    { key: "sync", label: "Sync healthy", ok: syncHealthy },
    { key: "approvals", label: "All approvals complete", ok: approvalsComplete },
  ];
  const okCount = checklist.filter((c) => c.ok).length;
  const score = Math.round((okCount / checklist.length) * 100);

  // ── KPIs (real metrics only) ──────────────────────────────────────────────
  const runsThisMonth = runs.filter((r) => {
    const stamp = r.publishedAt ?? r.approvedAt ?? r.createdAt;
    return stamp instanceof Date
      ? stamp.toISOString().slice(0, 7) === monthPrefix
      : false;
  }).length;
  // YTD payslip count → average cost per active employee. Honest: YTD spend
  // divided by current active headcount. Approximation flagged in the report.
  const costPerEmployeeCents =
    headcount > 0 ? Math.round(ytdCents / headcount) : null;
  const openPeriods = openPeriodRows.length;

  // Projected spend (next 4 weeks): YTD run-rate (YTD ÷ weeks elapsed) × 4.
  // An estimate, clearly labelled as such in the UI.
  const dayOfYear =
    Math.floor(
      (Date.UTC(year, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))) -
        Date.UTC(year, 0, 1)) /
        86_400_000,
    ) + 1;
  const weeksElapsed = Math.max(dayOfYear / 7, 1);
  const projectedSpendCents = Math.round((ytdCents / weeksElapsed) * 4);

  return {
    greetingName,
    todayLongLabel: longDate(today),
    cadences,
    trend: {
      points: trendPoints,
      ytdCents,
      deltaPct: trendDelta,
      compareLabel: priorWeekCompareLabel(today),
    },
    headcount,
    // Net headcount change requires a historical snapshot we don't store yet.
    headcountDelta: null,
    exceptions,
    sync: {
      state: syncState,
      lastSyncAt: lastPoll?.finishedAt?.toISOString() ?? null,
      points: syncPoints,
    },
    health: { score, checklist },
    kpis: {
      ytdSpendCents: ytdCents,
      costPerEmployeeCents,
      runsThisMonth,
      activeEmployees: headcount,
      projectedSpendCents,
    },
    automation: { runsThisMonth, openPeriods },
  };
}
