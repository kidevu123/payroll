import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Sparkles,
  TimerReset,
  Users,
  type LucideIcon,
} from "lucide-react";
import { and, asc, desc, eq, gt, lt, lte, gte, sql } from "drizzle-orm";
import { ensurePeriodForSchedule } from "@/lib/db/queries/pay-periods";
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
import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import { getSetting } from "@/lib/settings/runtime";
import { resolveTimeCellPeriodId } from "@/lib/time/grid-links";
import { formatHoursMinutes, formatTimeShort, localMidnightUtc } from "@/lib/utils";
import { db } from "@/lib/db";
import { payPeriods, paySchedules } from "@/lib/db/schema";
import { BackfillAlert } from "@/components/admin/backfill-alert";
import { MissedPunchRailCard } from "@/components/domain/missed-punch-rail-card";
import { companyDayIso } from "@/lib/time/company-day";

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  return companyDayIso(d, tz);
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
 * When no pay_period exists yet for monthly/semi-monthly, open the current
 * calendar month so clock polls and manual punches have a real period row
 * (same id the NGTeco importer uses via ensurePeriodForSchedule).
 */
async function ensureCadencePeriodForToday(
  kind: "SEMI_MONTHLY" | "MONTHLY",
  today: string,
): Promise<PeriodView | null> {
  const [schedule] = await db
    .select({ id: paySchedules.id })
    .from(paySchedules)
    .where(and(eq(paySchedules.active, true), eq(paySchedules.periodKind, kind)))
    .limit(1);
  if (!schedule) return null;
  const row = await ensurePeriodForSchedule(schedule.id, today, null);
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    payScheduleId: row.payScheduleId,
    state: row.state as "OPEN" | "LOCKED" | "PAID",
  };
}

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

  // Step 2: Any OPEN period for the cadence that hasn't ended yet.
  const anyOpenWhere = kind
    ? and(
        eq(payPeriods.state, "OPEN"),
        eq(paySchedules.periodKind, kind),
        gte(payPeriods.endDate, today),
      )
    : and(eq(payPeriods.state, "OPEN"), gte(payPeriods.endDate, today));
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
  if (!mostRecent) {
    if (kind === "MONTHLY" || kind === "SEMI_MONTHLY") {
      return ensureCadencePeriodForToday(kind, today);
    }
    return null;
  }

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
 * Sunday, the next Monday). For SEMI_MONTHLY / MONTHLY this is the next
 * full calendar month.
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
  // SEMI_MONTHLY and MONTHLY: next full calendar month
  const start = new Date(startDate);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() + 1);
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
    case "complete":
      return "bg-success-50 text-success-800";
    case "incomplete":
      return "bg-warn-50 text-warn-800";
    case "pto":
      return "bg-success-100/80 text-success-900";
    case "sick":
      return "bg-warn-100/80 text-warn-900";
    case "unpaid":
      return "bg-surface-2 text-text-muted";
    case "other":
      return "bg-info-50 text-info-800";
    default:
      return "";
  }
}

// Dot color for the legend.
function legendDotClass(state: CellState): string {
  switch (state) {
    case "complete":
      return "bg-success-500";
    case "incomplete":
      return "bg-warn-500";
    case "missed":
      return "bg-danger-500";
    case "pto":
      return "bg-success-400";
    default:
      return "bg-border-strong";
  }
}

// Mobile attendance-list status badge label + dash-palette color per state.
const MOBILE_STATUS: Record<CellState, { label: string; color: string }> = {
  complete: { label: "Complete", color: "var(--dash-emerald)" },
  incomplete: { label: "Unpaired", color: "var(--dash-amber)" },
  missed: { label: "Missing", color: "var(--dash-rose)" },
  future: { label: "—", color: "var(--dash-text-faint)" },
  inactive: { label: "Inactive", color: "var(--dash-text-faint)" },
  pto: { label: "PTO", color: "var(--dash-indigo)" },
  sick: { label: "Sick", color: "var(--dash-indigo)" },
  unpaid: { label: "Unpaid", color: "var(--dash-text-faint)" },
  other: { label: "Time off", color: "var(--dash-indigo)" },
};

function timeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
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
  searchParams: Promise<{ schedule?: string; period?: string; day?: string }>;
}) {
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);
  const sp = await searchParams;
  const tab = parseScheduleTab(sp.schedule);
  // Time only filters on punch-bearing cadences. The "SALARIED" synthetic
  // kind (returned by scheduleTabToKind for the Salaried tab) is handled by
  // the early return below, so collapse it to null here — salaried staff have
  // no punches and never reach the period/employee filters that use this.
  const rawKind = scheduleTabToKind(tab);
  const kindFilter: "WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | null =
    rawKind === "SALARIED" ? null : rawKind;

  // Salaried staff don't punch a clock — the Time grid is hourly punches only.
  // Without this guard the Salaried tab falls through (no kind filter) and
  // lists every hourly employee, which looked like data had moved around.
  if (tab === "salaried") {
    return (
      <div className="space-y-5">
        <ScheduleTabs current={tab} basePath="/time" />
        <EmptyState
          icon={CalendarDays}
          title="Salaried staff don't punch a clock"
          description="Salaried employees are paid externally and have no time punches. Manage their paystubs and documents on the Salaried page."
        />
      </div>
    );
  }

  // If a specific period ID is in the URL (?period=UUID), load it directly
  // so the admin can navigate to past/future weeks via the prev/next arrows.
  // Ignore ?period= when it belongs to a different schedule tab.
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
        kind: paySchedules.periodKind,
      })
      .from(payPeriods)
      .leftJoin(paySchedules, eq(payPeriods.payScheduleId, paySchedules.id))
      .where(eq(payPeriods.id, sp.period));
    if (row && (!kindFilter || row.kind === kindFilter)) {
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

  const returnToParams = new URLSearchParams();
  if (tab !== "all") returnToParams.set("schedule", tab);
  if (period?.id) returnToParams.set("period", period.id);
  const returnTo = `/time${returnToParams.size ? `?${returnToParams.toString()}` : ""}`;

  if (!period) {
    const payrollHref =
      tab === "semi"
        ? "/payroll?schedule=semi"
        : tab === "monthly"
          ? "/payroll?schedule=monthly"
          : tab === "weekly"
            ? "/payroll?schedule=weekly"
            : "/payroll";
    const clockFirst =
      tab === "monthly" || tab === "semi" || tab === "weekly";
    return (
      <div className="space-y-5">
        <ScheduleTabs current={tab} basePath="/time" />
        <EmptyState
          icon={CalendarDays}
          title={
            clockFirst
              ? "Waiting for clock punches"
              : "No pay periods yet"
          }
          description={
            clockFirst
              ? "Time fills from the NGTeco clock automatically — you do not need a CSV for day-to-day tracking. Make sure employees are on this pay schedule, then run Poll punches now on Payroll to sync, or add a manual punch below. CSV upload is only for one-off payroll runs."
              : "Pick a schedule tab (Weekly, Semi-monthly, or Monthly), or add a manual punch to get started."
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {clockFirst ? (
                <Button asChild>
                  <Link href={payrollHref}>Go to Payroll · sync clock</Link>
                </Button>
              ) : null}
              <Button asChild variant={clockFirst ? "secondary" : "default"}>
                <Link href="/punches/new">Add manual punch</Link>
              </Button>
            </div>
          }
        />
      </div>
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
    // Always load by date range. Filtering by period.id hid punches that
    // were saved under a sibling schedule's overlapping period (e.g. a
    // weekly employee's punch stuck in the semi-monthly Jun 1–30 row).
    listPunches({
      clockAfter: localMidnightUtc(period.startDate, company.timezone),
      clockBefore: new Date(
        localMidnightUtc(addDaysIso(lastDay, 1), company.timezone).getTime() - 1,
      ),
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
  const punchesInRange = punches;
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

  // ── KPI + rail metrics (drives the #57 attendance board) ──────────────
  const tz = company.timezone;
  let totalMinutes = 0;
  const minutesByEmp = new Map<string, number>();
  for (const p of punchesInRange) {
    if (!p.clockOut) continue;
    const mins = (p.clockOut.getTime() - p.clockIn.getTime()) / 60000;
    if (mins <= 0) continue;
    totalMinutes += mins;
    minutesByEmp.set(p.employeeId, (minutesByEmp.get(p.employeeId) ?? 0) + mins);
  }
  const fmtHm = (mins: number): string =>
    `${Math.floor(mins / 60).toLocaleString()}h ${Math.round(mins % 60)}m`;
  const teamSize = employees.filter((e) => e.status === "ACTIVE").length;
  const clockedInToday = new Set(
    punchesInRange
      .filter((p) => dayOf(p.clockIn, tz) === todayIso)
      .map((p) => p.employeeId),
  ).size;
  const teamPct = teamSize ? Math.round((clockedInToday / teamSize) * 100) : 0;
  const openNow = punchesInRange.filter(
    (p) => p.clockOut === null && dayOf(p.clockIn, tz) === todayIso,
  ).length;
  // Overtime: minutes beyond 40h per employee across the displayed window.
  const OT_MIN = 40 * 60;
  let regularMin = 0;
  let overtimeMin = 0;
  for (const m of minutesByEmp.values()) {
    if (m > OT_MIN) {
      regularMin += OT_MIN;
      overtimeMin += m - OT_MIN;
    } else regularMin += m;
  }
  const overtimeRisk = [...minutesByEmp.values()].filter((m) => m >= OT_MIN * 0.875).length;
  // Unpaired / ambiguous punches across the window (exceptions queue).
  const unpairedCount = punchesInRange.filter(
    (p) => isAmbiguousSinglePunch(p) || isMissingClockInPunch(p),
  ).length;
  // Today's column snapshot for the summary donut.
  const todaySummary = { present: 0, incomplete: 0, missing: 0, timeOff: 0, unpaid: 0 };
  for (const e of employees) {
    if (e.status !== "ACTIVE") continue;
    const list = grid.get(e.id)?.get(todayIso) ?? [];
    const offType = timeOffByDay.get(`${e.id}|${todayIso}`);
    if (list.length === 0) {
      if (offType === "UNPAID") todaySummary.unpaid++;
      else if (offType) todaySummary.timeOff++;
      else todaySummary.missing++;
    } else if (
      list.some(
        (p) => isAmbiguousSinglePunch(p) || isMissingClockInPunch(p) || isOpenShiftPunch(p),
      )
    ) {
      todaySummary.incomplete++;
    } else todaySummary.present++;
  }
  const summaryTotal =
    todaySummary.present +
    todaySummary.incomplete +
    todaySummary.missing +
    todaySummary.timeOff +
    todaySummary.unpaid;
  // Per-day labor hours for the rail sparkline.
  const hoursByDay = days.map((d) => {
    let mins = 0;
    for (const p of punchesInRange) {
      if (!p.clockOut) continue;
      if (dayOf(p.clockIn, tz) !== d) continue;
      mins += (p.clockOut.getTime() - p.clockIn.getTime()) / 60000;
    }
    return Math.round((mins / 60) * 10) / 10;
  });

  // Mobile day selector — show one day at a time as a vertical list. Default
  // to today when it's in the window, else the last day. URL-driven (?day=).
  const selectedDay =
    sp.day && days.includes(sp.day)
      ? sp.day
      : days.includes(today)
        ? today
        : (days[days.length - 1] ?? today);

  const stateBadge = (() => {
    switch (period.state) {
      case "UPCOMING":
        return { label: "Upcoming", cls: "bg-brand-50 text-brand-700 border-brand-200/80" };
      case "LOCKED":
        return { label: "Locked", cls: "bg-warn-50 text-warn-700 border-warn-200/80" };
      case "PAID":
        return { label: "Paid", cls: "bg-success-50 text-success-700 border-success-200/80" };
      default:
        return { label: "Open", cls: "bg-success-50 text-success-700 border-success-200/80" };
    }
  })();

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-title font-semibold tracking-tight">Time</h1>
            <span
              className={`inline-flex items-center rounded-chip border px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ${stateBadge.cls}`}
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
            <span className="text-body text-text-muted font-medium tabular-nums px-0.5">
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
            {/* Jump straight back to the current period (drops ?period= so the
                page auto-selects today's period for this schedule). */}
            <Link
              href={`/time${tab !== "all" ? `?schedule=${tab}` : ""}`}
              className="ml-1 h-6 inline-flex items-center rounded px-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
            >
              Today
            </Link>
          </div>
          <ScheduleTabs current={tab} basePath="/time" />
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <Button asChild size="sm" variant="secondary">
            <Link href="/punches/new">
              <Plus className="h-3.5 w-3.5" /> Add manual punch
            </Link>
          </Button>
          <div className="flex items-center gap-3 text-caption text-text-muted font-medium">
            <Legend label="Complete" state="complete" />
            <Legend label="Incomplete" state="incomplete" />
            <Legend label="Missed" state="missed" />
            <Legend label="Time off" state="pto" />
          </div>
        </div>
      </div>

      {/* KPI row — five attendance metrics (matches #57). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard icon={Clock} tone="emerald" value={fmtHm(totalMinutes)} label="Total hours" sub={`${days.length}-day period`} />
        <KpiCard icon={Users} tone="indigo" value={`${clockedInToday} / ${teamSize}`} label="Employees clocked in" sub={`${teamPct}% of team`} />
        <KpiCard icon={AlertTriangle} tone="amber" value={staleOpenPunchCount} label="Missing punches" sub={staleOpenPunchCount > 0 ? "Needs attention" : "All clear"} />
        <KpiCard icon={CalendarX2} tone="violet" value={openNow} label="Open shifts" sub="In progress now" />
        <KpiCard icon={TimerReset} tone="rose" value={overtimeRisk} label="Overtime risk" sub={overtimeRisk > 0 ? "Review needed" : "On track"} />
      </div>

      {staleOpenPunchCount > 0 && (
        <BackfillAlert openCountFromPriorDays={staleOpenPunchCount} />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          {/* ── Mobile: day pills + single-day attendance list (#68) ── */}
          <div className="lg:hidden -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {days.map((d) => {
              const isSel = d === selectedDay;
              const dt = new Date(`${d}T12:00:00Z`);
              const dow = new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                timeZone: "UTC",
              }).format(dt);
              const dom = new Intl.DateTimeFormat("en-US", {
                month: "numeric",
                day: "numeric",
                timeZone: "UTC",
              }).format(dt);
              return (
                <Link
                  key={d}
                  href={`/time?${new URLSearchParams({
                    ...(tab !== "all" ? { schedule: tab } : {}),
                    ...(period.id ? { period: period.id } : {}),
                    day: d,
                  })}`}
                  className={`flex shrink-0 flex-col items-center rounded-xl border px-3 py-1.5 text-center transition-colors ${
                    isSel
                      ? "border-brand-400 bg-brand-50 text-brand-700"
                      : "border-border bg-surface text-text-muted"
                  }`}
                >
                  <span className="text-[11px] font-semibold uppercase">{dow}</span>
                  <span className="text-xs font-bold tabular-nums">{dom}</span>
                </Link>
              );
            })}
          </div>

          <ul className="lg:hidden space-y-2">
            {employees.map((e) => {
              const list = grid.get(e.id)?.get(selectedDay) ?? [];
              const offType = timeOffByDay.get(`${e.id}|${selectedDay}`);
              const isFutureDay = selectedDay > today;
              let state: CellState;
              if (list.length === 0) {
                if (offType) state = timeOffStateFor(offType);
                else if (isFutureDay) state = "future";
                else state = "missed";
              } else if (
                list.some(
                  (p) =>
                    isAmbiguousSinglePunch(p) ||
                    isMissingClockInPunch(p) ||
                    isOpenShiftPunch(p),
                )
              ) {
                state = "incomplete";
              } else state = "complete";
              if (e.status !== "ACTIVE") state = "inactive";
              const sorted = [...list].sort(
                (a, b) => a.clockIn.getTime() - b.clockIn.getTime(),
              );
              const first = sorted[0];
              const last = sorted[sorted.length - 1];
              const closedMs = sorted.reduce(
                (acc, p) =>
                  p.clockOut ? acc + (p.clockOut.getTime() - p.clockIn.getTime()) : acc,
                0,
              );
              const totalMin = Math.round(closedMs / 60000);
              const cellPeriodId = resolveTimeCellPeriodId({
                currentPeriodId: period.id,
                punches: sorted,
              });
              const meta = MOBILE_STATUS[state];
              const range = first
                ? `${formatTimeShort(first.clockIn, company.timezone)} – ${
                    last && last.clockOut
                      ? formatTimeShort(last.clockOut, company.timezone)
                      : "—"
                  }`
                : "—";
              const hLabel =
                totalMin > 0 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : "";
              const inner = (
                <div className="flex items-center gap-3 rounded-card border border-border bg-surface p-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{
                      background: "color-mix(in srgb, var(--dash-violet) 16%, transparent)",
                      color: "var(--dash-violet)",
                    }}
                  >
                    {timeInitials(e.displayName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">
                      {e.displayName}
                    </div>
                    <div className="truncate text-xs tabular-nums text-text-muted">
                      {range}
                      {hLabel ? ` · ${hLabel}` : ""}
                    </div>
                  </div>
                  <span
                    className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                      color: meta.color,
                    }}
                  >
                    {meta.label}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                </div>
              );
              return (
                <li key={e.id}>
                  {cellPeriodId ? (
                    <Link
                      href={`/time/${cellPeriodId}/${selectedDay}/${e.id}?${new URLSearchParams({ returnTo })}`}
                      className="block"
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>

          {/* ── Desktop: full employee×day grid (data-grid surface) ──
              A bounded 2-axis scroll region so BOTH the employee column
              (sticky left) and the day header (sticky top) stay pinned while
              scrolling a wide/tall roster. The visible scrollbar is the
              horizontal-more cue. */}
          <div className="hidden lg:block max-h-[72vh] overflow-auto rounded-card border border-border/70 bg-surface shadow-card-strong">
        <table className="min-w-full text-body border-collapse">
          <thead>
            <tr className="sticky top-0 z-20 border-b border-border/80 bg-surface-2/95 backdrop-blur">
              <th className="sticky left-0 z-30 bg-surface-2 text-left px-4 py-2.5 text-caption font-semibold text-text-subtle uppercase tracking-widest whitespace-nowrap border-r border-border/50">
                Employee
              </th>
              {days.map((d) => {
                const isToday = d === today;
                return (
                  <th
                    key={d}
                    className={`w-28 py-2.5 px-2 text-center whitespace-nowrap border-b border-border/40 ${isToday ? "bg-brand-50" : "bg-surface-2"}`}
                  >
                    <span className={`flex flex-col items-center leading-tight ${isToday ? "text-brand-700" : "text-text-subtle"}`}>
                      <span className="text-[11px] font-bold uppercase tracking-widest">
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
                <td className="sticky left-0 z-10 bg-surface group-hover:bg-surface-2/80 px-4 py-2 font-medium text-body whitespace-nowrap border-r border-border/40 transition-colors">
                  <Link
                    href={`/employees/${e.id}`}
                    className="text-text hover:text-brand-700 hover:underline underline-offset-2 transition-colors"
                  >
                    {e.displayName}
                  </Link>
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
                  } else if (
                    list.some(
                      (p) =>
                        isAmbiguousSinglePunch(p) ||
                        isMissingClockInPunch(p) ||
                        isOpenShiftPunch(p),
                    )
                  ) {
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
                  const cellPeriodId = resolveTimeCellPeriodId({
                    currentPeriodId: period.id,
                    punches: sorted,
                  });
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
                      {cellPeriodId ? (
                        <Link
                          href={`/time/${cellPeriodId}/${d}/${e.id}?${new URLSearchParams({ returnTo })}`}
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

        {/* Right rail — pending reviews, today's summary, exceptions, labor,
            insight (#57). Missed-punch review sits at the top: it's the only
            card that needs an admin decision, and it lives next to the time
            grid it corrects (moved here from the Calendar rail). */}
        <aside className="space-y-3">
          <MissedPunchRailCard timezone={company.timezone} />
          <TodaySummaryCard summary={todaySummary} total={summaryTotal} />
          <ExceptionsQueueCard
            missing={staleOpenPunchCount}
            unpaired={unpairedCount}
            openShifts={openNow}
          />
          <LaborHoursCard
            regularMin={regularMin}
            overtimeMin={overtimeMin}
            totalMin={totalMinutes}
            spark={hoursByDay}
            fmtHm={fmtHm}
          />
          <MiloInsightCard overtimeRisk={overtimeRisk} />
        </aside>
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
    return <span className="text-danger-400 text-body font-medium">—</span>;
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
  if (state === "incomplete" && last && isAmbiguousSinglePunch(last)) {
    const punchLabel = formatTimeShort(last.clockIn, tz);
    return (
      <span
        className={`inline-flex flex-col items-center gap-0 rounded-[6px] px-2 py-1 w-full max-w-[108px] mx-auto leading-snug ${cellPillClasses(state)}`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          Unpaired
        </span>
        <span className="font-mono tabular-nums text-[10px] font-semibold whitespace-nowrap">
          {punchLabel}
        </span>
      </span>
    );
  }
  if (state === "incomplete" && last && isMissingClockInPunch(last)) {
    const outLabel = last.clockOut
      ? formatTimeShort(last.clockOut, tz)
      : "open";
    return (
      <span
        className={`inline-flex flex-col items-center gap-0 rounded-[6px] px-2 py-1 w-full max-w-[108px] mx-auto leading-snug ${cellPillClasses(state)}`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          Missing in
        </span>
        <span className="font-mono tabular-nums text-[10px] font-semibold whitespace-nowrap">
          out {outLabel}
        </span>
      </span>
    );
  }
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
        {count > 1 ? <span className="ml-0.5 text-[11px] opacity-60">+{count - 1}</span> : null}
      </span>
      <span className="text-[11px] font-medium opacity-65">
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

// ── #57 attendance-board KPI + rail components ───────────────────────────

const KPI_TONE: Record<string, string> = {
  emerald: "var(--dash-emerald)",
  indigo: "var(--dash-indigo)",
  amber: "var(--dash-amber)",
  violet: "var(--dash-violet)",
  rose: "var(--dash-rose)",
};

function KpiCard({
  icon: Icon,
  tone,
  value,
  label,
  sub,
}: {
  icon: LucideIcon;
  tone: keyof typeof KPI_TONE;
  value: string | number;
  label: string;
  sub: string;
}) {
  const c = KPI_TONE[tone];
  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="mt-2 text-xl font-bold leading-tight tabular-nums tracking-tight text-text">
        {value}
      </div>
      <div className="text-[12px] font-medium text-text-muted">{label}</div>
      <div className="text-[11px] font-medium" style={{ color: c }}>
        {sub}
      </div>
    </div>
  );
}

const SUMMARY_SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: "present", label: "Present", color: "var(--dash-emerald)" },
  { key: "incomplete", label: "Incomplete", color: "var(--dash-amber)" },
  { key: "missing", label: "Missing", color: "var(--dash-rose)" },
  { key: "timeOff", label: "Time off", color: "var(--dash-indigo)" },
  { key: "unpaid", label: "Unpaid", color: "var(--dash-text-faint)" },
];

function TodaySummaryCard({
  summary,
  total,
}: {
  summary: Record<string, number>;
  total: number;
}) {
  let acc = 0;
  const stops: string[] = [];
  for (const s of SUMMARY_SEGMENTS) {
    const v = summary[s.key] ?? 0;
    if (total > 0 && v > 0) {
      const start = (acc / total) * 360;
      acc += v;
      const end = (acc / total) * 360;
      stops.push(`${s.color} ${start}deg ${end}deg`);
    }
  }
  const ring =
    total > 0
      ? `conic-gradient(${stops.join(", ")})`
      : "conic-gradient(var(--dash-border) 0deg 360deg)";
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Today&rsquo;s summary</h3>
        <span className="text-[10px] uppercase tracking-wide text-text-subtle">
          Updated just now
        </span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div
          className="relative h-[88px] w-[88px] shrink-0 rounded-full"
          style={{ background: ring }}
        >
          <div className="absolute inset-[11px] flex flex-col items-center justify-center rounded-full bg-surface">
            <span className="text-lg font-bold leading-none tabular-nums">{total}</span>
            <span className="text-[10px] text-text-muted">Total</span>
          </div>
        </div>
        <ul className="flex-1 space-y-1">
          {SUMMARY_SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums">{summary[s.key] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ExceptionsQueueCard({
  missing,
  unpaired,
  openShifts,
}: {
  missing: number;
  unpaired: number;
  openShifts: number;
}) {
  const total = missing + unpaired + openShifts;
  const rows = [
    { label: "Missing punches", value: missing, color: "var(--dash-rose)" },
    { label: "Unpaired punches", value: unpaired, color: "var(--dash-amber)" },
    { label: "Open shifts", value: openShifts, color: "var(--dash-violet)" },
  ];
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          Exceptions queue
          {total > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn-50 px-1.5 text-[11px] font-bold text-warn-700">
              {total}
            </span>
          )}
        </h3>
        <Link
          href="/hall-monitor"
          className="text-[11px] font-medium text-brand-700 hover:underline"
        >
          View all
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="font-semibold tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 132;
  const h = 30;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`)
    .join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LaborHoursCard({
  regularMin,
  overtimeMin,
  totalMin,
  spark,
  fmtHm,
}: {
  regularMin: number;
  overtimeMin: number;
  totalMin: number;
  spark: number[];
  fmtHm: (mins: number) => string;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Labor hours</h3>
        <span className="text-[10px] uppercase tracking-wide text-text-subtle">
          This pay period
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-text-muted">Regular</dt>
          <dd className="font-semibold tabular-nums">{fmtHm(regularMin)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-muted">Overtime</dt>
          <dd className="font-semibold tabular-nums" style={{ color: "var(--dash-amber)" }}>
            {fmtHm(overtimeMin)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1.5">
          <dt className="font-medium">Total</dt>
          <dd className="font-bold tabular-nums">{fmtHm(totalMin)}</dd>
        </div>
      </dl>
      <div className="mt-2">
        <Sparkline data={spark} color="var(--dash-violet)" />
      </div>
    </div>
  );
}

function MiloInsightCard({ overtimeRisk }: { overtimeRisk: number }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-brand-700" />
        <h3 className="text-sm font-semibold">Milo insight</h3>
        <span
          className="rounded px-1 text-[11px] font-bold uppercase tracking-wide"
          style={{
            background: "color-mix(in srgb, var(--dash-violet) 18%, transparent)",
            color: "var(--dash-violet)",
          }}
        >
          Beta
        </span>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {overtimeRisk > 0
          ? `${overtimeRisk} team member${overtimeRisk === 1 ? "" : "s"} approaching overtime this period. Consider adjusting shifts or approving overtime.`
          : "No overtime risk this period — labor is tracking on plan."}
      </p>
      {overtimeRisk > 0 && (
        <Link
          href="/time"
          className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-border py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-surface-2"
        >
          Review overtime risk <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
