import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { and, asc, desc, eq, gt, lt, lte, gte, sql } from "drizzle-orm";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
} from "@/components/domain/schedule-tabs";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listApprovedInRange } from "@/lib/db/queries/time-off";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import { formatHoursMinutes, formatTimeShort } from "@/lib/utils";
import { db } from "@/lib/db";
import { payPeriods, paySchedules } from "@/lib/db/schema";
import { BackfillAlert } from "@/components/admin/backfill-alert";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function todayInTimezone(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

function eachDay(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function dayOf(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

type PeriodView = {
  /** Real DB id, or "" for a synthetic forward-rolled window. */
  id: string;
  startDate: string;
  endDate: string;
  payScheduleId: string | null;
  /** Display-only label about the period's underlying state. */
  state: "OPEN" | "LOCKED" | "PAID" | "UPCOMING";
};

/**
 * Pick the period to render for the current tab.
 *
 * Priority (matches owner's mental model — "if last week is locked, move on"):
 *   1. OPEN period covering today (preferred — matches the active week)
 *   2. Any OPEN period (most recent — covers the case where today falls
 *      in a gap between schedules)
 *   3. Synthetic forward-roll: if the most recent matching period is
 *      LOCKED or PAID, advance to the next 7-day Monday→Sunday window
 *      (Weekly) or next 1st-15th / 16th-EOM bucket (Semi-Monthly). The
 *      synthetic window has id="" — listPunches falls back to scanning
 *      by date range. Punches that arrive will auto-create the real
 *      period row via ensureNextPeriod in the importer.
 *   4. Most recent LOCKED/PAID period (last-resort, only when no OPEN
 *      and no rollable boundary exists — e.g. a schedule that's never
 *      had a period).
 *
 * SALARIED is filtered out of the Time grid entirely (no punches).
 */
async function pickPeriodForTab(
  kind: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | null,
  today: string,
): Promise<PeriodView | null> {
  // Step 1: OPEN period covering today, optionally filtered by kind.
  const openTodayBase = db
    .select({
      id: payPeriods.id,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      payScheduleId: payPeriods.payScheduleId,
      state: payPeriods.state,
      kind: paySchedules.periodKind,
    })
    .from(payPeriods)
    .leftJoin(paySchedules, eq(payPeriods.payScheduleId, paySchedules.id));
  const openTodayWhere = kind
    ? and(
        eq(payPeriods.state, "OPEN"),
        eq(paySchedules.periodKind, kind),
        lte(payPeriods.startDate, today),
        gte(payPeriods.endDate, today),
      )
    : and(
        eq(payPeriods.state, "OPEN"),
        lte(payPeriods.startDate, today),
        gte(payPeriods.endDate, today),
      );
  const [openToday] = await openTodayBase
    .where(openTodayWhere)
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  if (openToday) {
    return {
      id: openToday.id,
      startDate: openToday.startDate,
      endDate: openToday.endDate,
      payScheduleId: openToday.payScheduleId,
      state: "OPEN",
    };
  }

  // Step 2: Any OPEN period for the cadence (most recent).
  const anyOpenWhere = kind
    ? and(eq(payPeriods.state, "OPEN"), eq(paySchedules.periodKind, kind))
    : eq(payPeriods.state, "OPEN");
  const [anyOpen] = await openTodayBase
    .where(anyOpenWhere)
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  if (anyOpen) {
    return {
      id: anyOpen.id,
      startDate: anyOpen.startDate,
      endDate: anyOpen.endDate,
      payScheduleId: anyOpen.payScheduleId,
      state: "OPEN",
    };
  }

  // Step 3: Most recent LOCKED/PAID — used to compute the next window.
  const recentBase = db
    .select({
      id: payPeriods.id,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      payScheduleId: payPeriods.payScheduleId,
      state: payPeriods.state,
      kind: paySchedules.periodKind,
    })
    .from(payPeriods)
    .leftJoin(paySchedules, eq(payPeriods.payScheduleId, paySchedules.id));
  const [mostRecent] = await recentBase
    .where(kind ? eq(paySchedules.periodKind, kind) : undefined)
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  if (!mostRecent) return null;

  // If the most recent period is still happening (covers today), or is
  // OPEN, just use it. Otherwise — when it's LOCKED or PAID and ended
  // before today — roll forward to the next window so the admin sees
  // the live week instead of the closed one.
  if (mostRecent.state === "OPEN" || mostRecent.endDate >= today) {
    return {
      id: mostRecent.id,
      startDate: mostRecent.startDate,
      endDate: mostRecent.endDate,
      payScheduleId: mostRecent.payScheduleId,
      state: mostRecent.state as "OPEN" | "LOCKED" | "PAID",
    };
  }

  const rolledKind = kind ?? mostRecent.kind ?? "WEEKLY";
  const next = nextWindowAfter(
    mostRecent.endDate,
    rolledKind as "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY",
  );
  return {
    id: "",
    startDate: next.start,
    endDate: next.end,
    payScheduleId: mostRecent.payScheduleId,
    state: "UPCOMING",
  };
}

/**
 * Compute the start/end of the period that immediately follows
 * `prevEnd` for a given cadence. For WEEKLY this is the Mon→Sun week
 * starting the day after prevEnd (or, if prevEnd already ends on a
 * Sunday, the next Monday). For SEMI_MONTHLY this is the next 1st-15th
 * or 16th-EOM bucket.
 */
function nextWindowAfter(
  prevEnd: string,
  kind: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY",
): { start: string; end: string } {
  const startDate = new Date(`${prevEnd}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  if (kind === "WEEKLY") {
    const start = startDate;
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  if (kind === "BIWEEKLY") {
    const start = startDate;
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 13);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  if (kind === "SEMI_MONTHLY") {
    const day = startDate.getUTCDate();
    if (day <= 15) {
      const start = new Date(startDate);
      start.setUTCDate(1);
      const end = new Date(start);
      end.setUTCDate(15);
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    } else {
      const start = new Date(startDate);
      start.setUTCDate(16);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(0); // last day of original month
      return {
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      };
    }
  }
  // MONTHLY
  const start = new Date(startDate);
  start.setUTCDate(1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/**
 * Given a period, return the IDs of the immediately preceding and following
 * periods in the same pay schedule. Used to render prev/next nav arrows on
 * the time grid. Returns nulls for synthetic (id="") periods or when no
 * adjacent period exists.
 */
async function findAdjacentPeriods(
  period: PeriodView,
): Promise<{ prevId: string | null; nextId: string | null }> {
  if (!period.id) return { prevId: null, nextId: null };
  const schedFilter = period.payScheduleId
    ? eq(payPeriods.payScheduleId, period.payScheduleId)
    : undefined;

  const [prevRow] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(
      schedFilter
        ? and(schedFilter, lt(payPeriods.startDate, period.startDate))
        : lt(payPeriods.startDate, period.startDate),
    )
    .orderBy(desc(payPeriods.startDate))
    .limit(1);

  const [nextRow] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(
      schedFilter
        ? and(schedFilter, gt(payPeriods.startDate, period.endDate))
        : gt(payPeriods.startDate, period.endDate),
    )
    .orderBy(asc(payPeriods.startDate))
    .limit(1);

  return { prevId: prevRow?.id ?? null, nextId: nextRow?.id ?? null };
}

type CellState =
  | "complete"
  | "incomplete"
  | "missed"   // past day with no punch — genuinely absent
  | "future"   // day hasn't happened yet — no punch expected
  | "inactive"
  | "pto"      // approved PERSONAL / paid time off
  | "sick"     // approved SICK
  | "unpaid"   // approved UNPAID
  | "other";   // approved OTHER

// Background + text for cells that show a filled chip (data cells).
function cellPillClasses(state: CellState): string {
  switch (state) {
    case "complete":   return "bg-emerald-50 text-emerald-800";
    case "incomplete": return "bg-amber-50 text-amber-800";
    case "pto":        return "bg-emerald-100/70 text-emerald-900";
    case "sick":       return "bg-amber-100/70 text-amber-900";
    case "unpaid":     return "bg-surface-2 text-text-muted";
    case "other":      return "bg-purple-100/70 text-purple-900";
    default:           return "";
  }
}

// Dot color for the legend.
function legendDotClass(state: CellState): string {
  switch (state) {
    case "complete":   return "bg-emerald-500";
    case "incomplete": return "bg-amber-400";
    case "missed":     return "bg-red-400";
    case "pto":        return "bg-emerald-400";
    default:           return "bg-border-strong";
  }
}

function timeOffStateFor(
  type: "UNPAID" | "SICK" | "PERSONAL" | "OTHER",
): CellState {
  switch (type) {
    case "PERSONAL":
      return "pto";
    case "SICK":
      return "sick";
    case "UNPAID":
      return "unpaid";
    case "OTHER":
      return "other";
  }
}

function timeOffLabel(state: CellState): string {
  switch (state) {
    case "pto":
      return "PTO";
    case "sick":
      return "Sick";
    case "unpaid":
      return "Unpaid";
    case "other":
      return "Off";
    default:
      return "";
  }
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string; period?: string }>;
}) {
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);
  const sp = await searchParams;
  const tab = parseScheduleTab(sp.schedule);
  const kindFilter = scheduleTabToKind(tab);

  // If a specific period ID is in the URL (?period=UUID), load it directly
  // so the admin can navigate to past/future weeks via the prev/next arrows.
  // Otherwise fall back to auto-selecting the current period for the tab.
  let period: PeriodView | null = null;
  if (sp.period) {
    const [row] = await db
      .select({
        id: payPeriods.id,
        startDate: payPeriods.startDate,
        endDate: payPeriods.endDate,
        payScheduleId: payPeriods.payScheduleId,
        state: payPeriods.state,
      })
      .from(payPeriods)
      .where(eq(payPeriods.id, sp.period));
    if (row) {
      period = {
        id: row.id,
        startDate: row.startDate,
        endDate: row.endDate,
        payScheduleId: row.payScheduleId,
        state: row.state as "OPEN" | "LOCKED" | "PAID",
      };
    }
  }
  if (!period) {
    period = await pickPeriodForTab(kindFilter, today);
  }

  if (!period) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No pay periods yet"
        description="Upload a CSV from /run-payroll/upload to create the first period, or add a manual punch."
        action={
          <Button asChild>
            <Link href="/run-payroll/upload">Upload CSV</Link>
          </Button>
        }
      />
    );
  }

  // Canonical 7-day work week: render Monday → Sunday regardless of
  // how the upload was scoped. Owner pulls punches early sometimes
  // (Mon-Fri because no work happened Sat-Sun) but the displayed
  // grid should still reflect the full pay week so empty Sat/Sun
  // cells are visible. eachDay only goes as far as the stored
  // end_date, so widen it to start+6 days when the stored range is
  // shorter.
  const canonicalEnd = (() => {
    const start = new Date(`${period.startDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + 6);
    return start.toISOString().slice(0, 10);
  })();
  const lastDay =
    period.endDate < canonicalEnd ? canonicalEnd : period.endDate;
  const days = eachDay(period.startDate, lastDay);
  const [allActive, punches, approvedTimeOff, adjacent] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    // "All" tab: query by clockIn date range so punches from every
    // schedule's period in this window appear. Without this, an
    // unscheduled period could be picked by pickPeriodForTab(null)
    // while actual punches live under a different (scheduled) period,
    // making the whole grid show dashes.
    //
    // Specific tab (Weekly / Semi-monthly): filter by the picked
    // period's ID so only that schedule's punches appear. Synthetic
    // forward-rolled period (period.id === "") has no real row yet —
    // load all punches and filter by date below.
    kindFilter
      ? (period.id
          ? listPunches({ periodId: period.id })
          : listPunches({}))
      : listPunches({
          clockAfter: new Date(`${period.startDate}T00:00:00Z`),
          clockBefore: new Date(`${lastDay}T23:59:59Z`),
        }),
    // Approved time-off intersecting the displayed grid window. Owner
    // ask: "if I'm looking at Elvia's time it would help to know right
    // away she was off". So the cell shows the time-off type instead
    // of a missed-punch red.
    listApprovedInRange(period.startDate, lastDay),
    findAdjacentPeriods(period),
  ]);
  // Build employeeId+date → time-off-type map for O(1) cell lookup.
  // SCHEDULE_NOTE is a heads-up, not actual time off — skip those so
  // the grid still shows the underlying punches for that day instead
  // of hiding the cell behind a "Sick"-style label.
  const timeOffByDay = new Map<string, "UNPAID" | "SICK" | "PERSONAL" | "OTHER">();
  for (const r of approvedTimeOff) {
    if (r.type === "SCHEDULE_NOTE") continue;
    const start = new Date(`${r.startDate}T00:00:00Z`);
    const end = new Date(`${r.endDate}T00:00:00Z`);
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
    ) {
      const dayIso = d.toISOString().slice(0, 10);
      timeOffByDay.set(`${r.employeeId}|${dayIso}`, r.type);
    }
  }
  // "All" tab punches are already filtered by date range in the query.
  // Specific tabs: if the period is real (has an ID), all its punches
  // are valid; synthetic periods need a client-side date filter.
  const startEpoch = new Date(`${period.startDate}T00:00:00Z`).getTime();
  const endEpoch = new Date(`${period.endDate}T23:59:59Z`).getTime();
  const punchesInRange = (!kindFilter || period.id)
    ? punches
    : punches.filter((p) => {
        const t = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
        const ms = t.getTime();
        return ms >= startEpoch && ms <= endEpoch;
      });
  // SALARIED staff don't punch — hide them from the grid so the admin
  // doesn't see "missed" red cells for everyone-on-salary every day.
  // Schedule-tab filter: when the admin picks Weekly / Semi-monthly,
  // only show employees on a matching schedule (employees with a NULL
  // schedule are wildcards and stay visible across both tabs).
  const employees = allActive
    .filter((e) => e.payType !== "SALARIED")
    .filter((e) => {
      if (!kindFilter) return true;
      if (e.payScheduleId === null) return true;
      return e.payScheduleId === period.payScheduleId;
    });

  // Count IN-only punches whose date is BEFORE today's calendar date in
  // the company timezone. These are the punches that look like "open"
  // cells from prior days — exactly what an operator notices when a
  // sync was missed. The Backfill alert renders only when this is > 0,
  // so when the system is healthy the /time page stays uncluttered.
  const todayIso = todayInTimezone(company.timezone);
  const staleOpenPunchCount = punchesInRange.reduce((n, p) => {
    if (p.clockOut !== null) return n;
    const d = dayOf(p.clockIn, company.timezone);
    return d < todayIso ? n + 1 : n;
  }, 0);

  // Group punches by employeeId + day, then dedup near-duplicates within
  // each cell so the grid doesn't show "1" / "2" cells for what's really
  // a single shift represented twice.
  const grid = new Map<string, Map<string, typeof punchesInRange>>();
  for (const e of employees) grid.set(e.id, new Map());
  for (const p of punchesInRange) {
    const day = dayOf(p.clockIn, company.timezone);
    const byDay = grid.get(p.employeeId);
    if (!byDay) continue;
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  for (const byDay of grid.values()) {
    for (const [day, list] of byDay) {
      byDay.set(day, dedupNearDuplicatePunches(list));
    }
  }

  const stateBadge = (() => {
    switch (period.state) {
      case "UPCOMING":
        return { label: "Upcoming", cls: "bg-brand-50 text-brand-700 border-brand-200/80" };
      case "LOCKED":
        return { label: "Locked", cls: "bg-warn-50 text-warn-700 border-warn-200/80" };
      case "PAID":
        return { label: "Paid", cls: "bg-success-50 text-success-700 border-success-200/80" };
      default:
        return { label: "Open", cls: "bg-emerald-50 text-emerald-700 border-emerald-200/80" };
    }
  })();

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-heading font-bold tracking-tight">Time</h1>
            <span
              className={`inline-flex items-center rounded-chip border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${stateBadge.cls}`}
            >
              {stateBadge.label}
            </span>
          </div>
          {/* Period date range with prev/next navigation */}
          <div className="flex items-center gap-1">
            {adjacent.prevId ? (
              <Link
                href={`/time?${new URLSearchParams({ ...(tab !== "all" ? { schedule: tab } : {}), period: adjacent.prevId })}`}
                className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
                aria-label="Previous period"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <span className="h-6 w-6 inline-flex items-center justify-center text-text-subtle/20">
                <ChevronLeft className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="text-sm text-text-muted font-medium tabular-nums px-0.5">
              {period.startDate}
              <span className="mx-1.5 text-text-subtle">&rarr;</span>
              {lastDay}
              {period.state === "UPCOMING" && (
                <span className="ml-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand-600">
                  live · punches will land here
                </span>
              )}
            </span>
            {adjacent.nextId ? (
              <Link
                href={`/time?${new URLSearchParams({ ...(tab !== "all" ? { schedule: tab } : {}), period: adjacent.nextId })}`}
                className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
                aria-label="Next period"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <span className="h-6 w-6 inline-flex items-center justify-center text-text-subtle/20">
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          <ScheduleTabs current={tab} basePath="/time" />
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <Button asChild size="sm" variant="secondary">
            <Link href="/punches/new">
              <Plus className="h-3.5 w-3.5" /> Add manual punch
            </Link>
          </Button>
          <div className="flex items-center gap-3 text-[11px] text-text-muted font-medium">
            <Legend label="Complete" state="complete" />
            <Legend label="Incomplete" state="incomplete" />
            <Legend label="Missed" state="missed" />
            <Legend label="Time off" state="pto" />
          </div>
        </div>
      </div>

      {staleOpenPunchCount > 0 && (
        <BackfillAlert openCountFromPriorDays={staleOpenPunchCount} />
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/80">
              <th className="sticky left-0 z-10 bg-surface-2/80 text-left px-4 py-2.5 text-[10px] font-semibold text-text-subtle uppercase tracking-widest whitespace-nowrap border-r border-border/50">
                Employee
              </th>
              {days.map((d) => {
                const isToday = d === today;
                return (
                  <th
                    key={d}
                    className={`w-28 py-2.5 px-2 text-center whitespace-nowrap ${isToday ? "bg-brand-50/60" : "bg-surface-2/40"}`}
                  >
                    <span className={`flex flex-col items-center leading-tight ${isToday ? "text-brand-700" : "text-text-subtle"}`}>
                      <span className="text-[9.5px] font-bold uppercase tracking-widest">
                        {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
                          new Date(`${d}T00:00:00Z`),
                        )}
                      </span>
                      <span className="font-mono tabular-nums text-[11px] font-semibold mt-0.5">
                        {new Intl.DateTimeFormat("en-US", {
                          month: "numeric",
                          day: "numeric",
                        }).format(new Date(`${d}T00:00:00Z`))}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr
                key={e.id}
                className="border-t border-border/40 group hover:bg-surface-2/30 transition-colors"
              >
                <td className="sticky left-0 z-10 bg-surface group-hover:bg-surface-2/50 px-4 py-2 font-semibold text-[12px] text-text whitespace-nowrap border-r border-border/40 transition-colors">
                  {e.displayName}
                </td>
                {days.map((d) => {
                  const isToday = d === today;
                  const isFutureDay = d > today;
                  const list = grid.get(e.id)?.get(d) ?? [];
                  const offType = timeOffByDay.get(`${e.id}|${d}`);
                  let state: CellState;
                  if (list.length === 0) {
                    if (offType) {
                      state = timeOffStateFor(offType);
                    } else if (isFutureDay) {
                      // Day hasn't happened — don't show red
                      state = "future";
                    } else {
                      state = "missed";
                    }
                  } else if (list.some((p) => !p.clockOut)) {
                    state = "incomplete";
                  } else {
                    state = "complete";
                  }
                  if (e.status !== "ACTIVE") state = "inactive";

                  const sorted = [...list].sort(
                    (a, b) => a.clockIn.getTime() - b.clockIn.getTime(),
                  );
                  const first = sorted[0];
                  const last = sorted[sorted.length - 1];
                  const closedMs = sorted.reduce((acc, p) => {
                    if (!p.clockOut) return acc;
                    return acc + (p.clockOut.getTime() - p.clockIn.getTime());
                  }, 0);
                  const hours = closedMs / (1000 * 60 * 60);

                  const cellContent = (
                    <PunchCellContent
                      state={state}
                      first={first}
                      last={last}
                      count={sorted.length}
                      hours={hours}
                      tz={company.timezone}
                    />
                  );

                  return (
                    <td
                      key={d}
                      className={`py-1.5 px-1.5 align-middle text-center ${isToday ? "bg-brand-50/25 group-hover:bg-brand-50/40" : ""}`}
                    >
                      {period.id ? (
                        <Link
                          href={`/time/${period.id}/${d}/${e.id}`}
                          className="block"
                          aria-label={cellAriaLabel(state, sorted, company.timezone)}
                        >
                          {cellContent}
                        </Link>
                      ) : (
                        <span aria-label={cellAriaLabel(state, sorted, company.timezone)}>
                          {cellContent}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend({ label, state }: { label: string; state: CellState }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full shrink-0 ${legendDotClass(state)}`} />
      {label}
    </span>
  );
}

type PunchLite = { clockIn: Date; clockOut: Date | null };

function PunchCellContent({
  state,
  first,
  last,
  count,
  hours,
  tz,
}: {
  state: CellState;
  first: PunchLite | undefined;
  last: PunchLite | undefined;
  count: number;
  hours: number;
  tz: string;
}) {
  // Empty / non-data states: just a dash character with color.
  if (state === "future") {
    return <span className="text-border-strong text-[11px] select-none">—</span>;
  }
  if (state === "inactive") {
    return <span className="text-text-subtle/30 text-[11px] select-none">—</span>;
  }
  if (state === "missed") {
    return <span className="text-red-300 text-[12px] font-medium">—</span>;
  }

  // Time-off label: compact uppercase badge.
  if (state === "pto" || state === "sick" || state === "unpaid" || state === "other") {
    return (
      <span className={`inline-block rounded-[5px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cellPillClasses(state)}`}>
        {timeOffLabel(state)}
      </span>
    );
  }

  // Data states (complete / incomplete): pill with time range + duration.
  if (!first) return <span className="text-border-strong text-[11px]">—</span>;
  const inLabel = formatTimeShort(first.clockIn, tz);
  const outLabel = last && last.clockOut ? formatTimeShort(last.clockOut, tz) : "open";
  return (
    <span
      className={`inline-flex flex-col items-center gap-0 rounded-[6px] px-2 py-1 w-full max-w-[108px] mx-auto leading-snug transition-all hover:brightness-95 ${cellPillClasses(state)}`}
    >
      <span className="font-mono tabular-nums text-[10px] font-semibold whitespace-nowrap">
        {inLabel}
        <span className="opacity-40 mx-0.5">&ndash;</span>
        {outLabel}
        {count > 1 ? <span className="ml-0.5 text-[9px] opacity-60">+{count - 1}</span> : null}
      </span>
      <span className="text-[9px] font-medium opacity-65">
        {state === "incomplete" ? "in progress" : formatHoursMinutes(hours)}
      </span>
    </span>
  );
}

function cellAriaLabel(state: CellState, list: PunchLite[], tz: string): string {
  if (state === "inactive") return "Inactive employee";
  if (state === "pto") return "Approved time off — PTO";
  if (state === "sick") return "Approved time off — Sick";
  if (state === "unpaid") return "Approved time off — Unpaid";
  if (state === "other") return "Approved time off";
  if (list.length === 0) return "No punches — missed day";
  const lines = list.map((p) => {
    const inS = formatTimeShort(p.clockIn, tz);
    const outS = p.clockOut ? formatTimeShort(p.clockOut, tz) : "still open";
    return `${inS} to ${outS}`;
  });
  return lines.join("; ");
}
