import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { and, desc, eq, lte, gte, sql } from "drizzle-orm";
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

type CellState =
  | "complete"
  | "incomplete"
  | "missed"
  | "inactive"
  | "pto" // approved PERSONAL / paid time off
  | "sick" // approved SICK
  | "unpaid" // approved UNPAID
  | "other"; // approved OTHER

function cellClasses(state: CellState): string {
  switch (state) {
    case "complete":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "incomplete":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "missed":
      return "bg-red-50 text-red-700 border-red-200";
    case "inactive":
      return "bg-surface-2 text-text-muted border-border";
    // Time-off cells reuse the calendar's color language so admin can
    // recognize "Elvia is off today" instantly. Approved-only — pending
    // requests still render as the default state until admin resolves.
    case "pto":
      return "bg-emerald-100 text-emerald-900 border-emerald-300";
    case "sick":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "unpaid":
      return "bg-surface-2 text-text-muted border-border-strong";
    case "other":
      return "bg-purple-100 text-purple-900 border-purple-300";
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
  searchParams: Promise<{ schedule?: string }>;
}) {
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);
  const tab = parseScheduleTab((await searchParams).schedule);
  const kindFilter = scheduleTabToKind(tab);

  // Read-only — auto-create disabled. Period creation now belongs to
  // the CSV upload + manual punch flows. Tab-aware: when filtering by
  // weekly / semi-monthly, pick the most recent period whose schedule
  // matches the tab. Defaults to the schedule-agnostic latest period.
  const period = await pickPeriodForTab(kindFilter, today);

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
  const [allActive, punches, approvedTimeOff] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    // Synthetic forward-rolled period (period.id === "") has no real
    // payPeriods row yet — fetch every active punch and filter by date
    // range below. The period row gets created lazily by the punch
    // importer when the first real punch lands.
    period.id
      ? listPunches({ periodId: period.id })
      : listPunches({}),
    // Approved time-off intersecting the displayed grid window. Owner
    // ask: "if I'm looking at Elvia's time it would help to know right
    // away she was off". So the cell shows the time-off type instead
    // of a missed-punch red.
    listApprovedInRange(period.startDate, lastDay),
  ]);
  // Build employeeId+date → time-off-type map for O(1) cell lookup.
  const timeOffByDay = new Map<string, "UNPAID" | "SICK" | "PERSONAL" | "OTHER">();
  for (const r of approvedTimeOff) {
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
  const startEpoch = new Date(`${period.startDate}T00:00:00Z`).getTime();
  const endEpoch = new Date(`${period.endDate}T23:59:59Z`).getTime();
  const punchesInRange = period.id
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

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Time</h1>
          <p className="text-sm text-text-muted">
            {period.state === "UPCOMING"
              ? "Upcoming week"
              : period.state === "LOCKED"
                ? "Locked period"
                : period.state === "PAID"
                  ? "Paid period"
                  : "Current period"}
            : {period.startDate} to {lastDay}
            {period.state === "UPCOMING" && (
              <span className="ml-2 text-[11px] uppercase tracking-wider text-brand-700">
                live · punches will land here
              </span>
            )}
          </p>
          <ScheduleTabs current={tab} basePath="/time" />
        </div>
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="secondary">
            <Link href="/punches/new">
              <Plus className="h-4 w-4" /> Add manual punch
            </Link>
          </Button>
          <div className="flex items-center gap-3 text-xs">
            <Legend label="Complete" state="complete" />
            <Legend label="Incomplete" state="incomplete" />
            <Legend label="Missed" state="missed" />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-surface-2/80 backdrop-blur text-text-subtle uppercase text-[10px] tracking-wider">
            <tr>
              <th className="text-left px-3 py-2.5 font-medium">Employee</th>
              {days.map((d) => (
                <th key={d} className="px-2 py-2.5 font-medium font-mono tabular-nums">
                  {new Intl.DateTimeFormat("en-US", {
                    weekday: "short",
                    month: "numeric",
                    day: "numeric",
                  }).format(new Date(`${d}T00:00:00Z`))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-border hover:bg-surface-2/40 transition-colors">
                <td className="px-3 py-2 font-medium">{e.displayName}</td>
                {days.map((d) => {
                  const list = grid.get(e.id)?.get(d) ?? [];
                  const offType = timeOffByDay.get(`${e.id}|${d}`);
                  let state: CellState;
                  if (list.length === 0) {
                    // No punches: was the employee approved off? If so,
                    // render the time-off chip rather than a "missed"
                    // red. Punches override (employee may have clocked
                    // in even with PTO on file — don't hide that).
                    state = offType ? timeOffStateFor(offType) : "missed";
                  } else if (list.some((p) => !p.clockOut)) {
                    state = "incomplete";
                  } else {
                    state = "complete";
                  }
                  if (e.status !== "ACTIVE") state = "inactive";

                  // Sort by clockIn so first-in / last-out are stable.
                  const sorted = [...list].sort(
                    (a, b) => a.clockIn.getTime() - b.clockIn.getTime(),
                  );
                  const first = sorted[0];
                  const last = sorted[sorted.length - 1];
                  // Sum hours across closed punches. Open punches contribute nothing
                  // (we don't show "elapsed so far"; the cell label "open" makes that obvious).
                  const closedMs = sorted.reduce((acc, p) => {
                    if (!p.clockOut) return acc;
                    return acc + (p.clockOut.getTime() - p.clockIn.getTime());
                  }, 0);
                  const hours = closedMs / (1000 * 60 * 60);

                  // Synthetic forward-rolled period has no DB id yet, so
                  // edit links can't deep-link to /time/[periodId]/...
                  // Render a non-interactive cell instead. The first
                  // punch that lands creates the real period row.
                  const cellInner = (
                    <span className={`flex flex-col items-stretch justify-center rounded-chip border px-2 py-1 min-h-9 w-full text-[10px] leading-tight ${cellClasses(state)}${period.id ? " hover:brightness-95" : ""}`}>
                      <PunchCellContent
                        state={state}
                        first={first}
                        last={last}
                        count={sorted.length}
                        hours={hours}
                        tz={company.timezone}
                      />
                    </span>
                  );
                  return (
                    <td key={d} className="p-1 align-middle">
                      {period.id ? (
                        <Link
                          href={`/time/${period.id}/${d}/${e.id}`}
                          className="block"
                          aria-label={cellAriaLabel(state, sorted, company.timezone)}
                        >
                          {cellInner}
                        </Link>
                      ) : (
                        <span aria-label={cellAriaLabel(state, sorted, company.timezone)}>
                          {cellInner}
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
    <span className={`inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 ${cellClasses(state)}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-60" /> {label}
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
  // Time-off state: render the type label instead of "—" or punches.
  // No punches landed today AND the employee is approved off → show
  // "PTO" / "Sick" / "Unpaid" / "Off" so the row reads correctly at a
  // glance.
  if (
    state === "pto" ||
    state === "sick" ||
    state === "unpaid" ||
    state === "other"
  ) {
    return (
      <span className="text-center font-medium tracking-wide text-[10px] uppercase">
        {timeOffLabel(state)}
      </span>
    );
  }
  if (state === "inactive" || !first) {
    return (
      <span className="font-mono tabular-nums text-center opacity-70">—</span>
    );
  }
  const inLabel = formatTimeShort(first.clockIn, tz);
  const outLabel = last && last.clockOut ? formatTimeShort(last.clockOut, tz) : "?";
  return (
    <>
      <span className="font-mono tabular-nums text-center">
        {inLabel}–{outLabel}
        {count > 1 ? <span className="ml-1 opacity-70">+{count - 1}</span> : null}
      </span>
      <span className="text-center opacity-75">
        {state === "incomplete" ? "open" : formatHoursMinutes(hours)}
      </span>
    </>
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
