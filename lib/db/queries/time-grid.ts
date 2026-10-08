// Database side of "which pay period does the /time grid show". These find
// candidate rows; the selection RULES are pure functions in
// lib/time-grid/period-select.ts (unit-tested there). Moved out of
// app/(admin)/time/page.tsx unchanged apart from calling those rules.
import { and, asc, desc, eq, gt, lt, lte, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods, paySchedules } from "@/lib/db/schema";
import { ensurePeriodForSchedule } from "@/lib/db/queries/pay-periods";
import {
  resolveFromMostRecent,
  type PeriodKind,
  type PeriodView,
} from "@/lib/time-grid/period-select";

/**
 * When no pay_period exists yet for monthly/semi-monthly, open the current
 * calendar month so clock polls and manual punches have a real period row
 * (same id the NGTeco importer uses via ensurePeriodForSchedule).
 */
export async function ensureCadencePeriodForToday(
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
export async function pickPeriodForTab(
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

  // OPEN, or still covering today: use it. Otherwise roll forward to the next
  // synthetic window (rule + tests: lib/time-grid/period-select.ts).
  return resolveFromMostRecent(
    { ...mostRecent, state: mostRecent.state as "OPEN" | "LOCKED" | "PAID" },
    today,
    kind,
  );
}

/**
 * Given a period, return the IDs of the immediately preceding and following
 * periods in the same pay schedule. Used to render prev/next nav arrows on
 * the time grid. Returns nulls for synthetic (id="") periods or when no
 * adjacent period exists.
 */
export async function findAdjacentPeriods(
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

/**
 * Load one period by id for `?period=<uuid>` navigation. Returns null when
 * the id is unknown or belongs to a different schedule tab than `kindFilter`.
 */
export async function loadPeriodForTab(
  id: string,
  kindFilter: PeriodKind | null,
): Promise<PeriodView | null> {
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
    .where(eq(payPeriods.id, id));
  if (!row || (kindFilter && row.kind !== kindFilter)) return null;
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    payScheduleId: row.payScheduleId,
    state: row.state as "OPEN" | "LOCKED" | "PAID",
  };
}
