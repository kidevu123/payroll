// Pay-period boundary calculator. Pure.
//
// Given a date (a YYYY-MM-DD string in company.timezone) and the company's
// payPeriod settings, returns the [startDate, endDate] of the period that
// contains the date.
//
// Anchor:
//   • If `firstStartDate` is set, it's the canonical start of period zero.
//     Period N begins at `firstStartDate + N * lengthDays`.
//   • If unset, periods anchor on the most recent occurrence of
//     `startDayOfWeek` on-or-before the date, then extend `lengthDays`.
//
// All math is on calendar days — UTC offsets don't enter here. The caller
// is responsible for converting timestamps to the company-tz day before
// passing them in.

import type { PayPeriodSettings } from "@/lib/settings/schemas";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Strict YYYY-MM-DD parser → epoch-day at UTC midnight. */
function parseDay(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    throw new Error(`period-boundaries: not a YYYY-MM-DD date: ${iso}`);
  }
  // Build via UTC so daylight-saving in any local zone never shifts the day.
  // The match guarantees three captured groups exist. `!` is a type-only
  // assertion; no runtime branch is added.
  const y = Number.parseInt(m[1]!, 10);
  const mo = Number.parseInt(m[2]!, 10);
  const d = Number.parseInt(m[3]!, 10);
  return new Date(Date.UTC(y, mo - 1, d));
}

function formatDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

export type PeriodBounds = { startDate: string; endDate: string };

/**
 * Compute the period bounds for `date` under `settings`. Returns inclusive
 * startDate and endDate as YYYY-MM-DD strings.
 */
export function getPeriodBounds(
  date: string,
  settings: PayPeriodSettings,
): PeriodBounds {
  const target = parseDay(date);
  const length = settings.lengthDays;

  if (settings.firstStartDate) {
    const anchor = parseDay(settings.firstStartDate);
    const offset = diffDays(target, anchor);
    // floor-divide to allow target < anchor (negative period numbers).
    const periodIndex = Math.floor(offset / length);
    const start = addDays(anchor, periodIndex * length);
    const end = addDays(start, length - 1);
    return { startDate: formatDay(start), endDate: formatDay(end) };
  }

  // No anchor. For weekly+ periods, back up to the most recent
  // `startDayOfWeek` occurrence. For sub-week periods (e.g. daily) the
  // weekly anchor is meaningless; treat the target itself as the start.
  if (length < 7) {
    const end = addDays(target, length - 1);
    return { startDate: formatDay(target), endDate: formatDay(end) };
  }
  const targetDow = target.getUTCDay(); // 0=Sun..6=Sat
  const backStep = (targetDow - settings.startDayOfWeek + 7) % 7;
  const start = addDays(target, -backStep);
  const end = addDays(start, length - 1);
  return { startDate: formatDay(start), endDate: formatDay(end) };
}

/**
 * Convenience: bounds of the period AFTER the given period.
 */
export function getNextPeriodBounds(
  current: PeriodBounds,
  settings: PayPeriodSettings,
): PeriodBounds {
  const start = addDays(parseDay(current.endDate), 1);
  return getPeriodBounds(formatDay(start), settings);
}

/**
 * Compute the canonical end of a period given the schedule's kind. For
 * weekly schedules the canonical period is start + 6 days even if the
 * stored end is shorter (a "Mon-Fri" upload still reads as the full
 * Mon-Sun pay week). Returns null when the schedule isn't weekly OR
 * when the canonical end isn't actually beyond the stored end (i.e.
 * the stored range already covers the canonical period).
 *
 * Used by /payroll/[periodId] header, /payroll Recent periods,
 * /reports table, /time grid, the admin-report PDF, and the Zoho
 * expense reference + intro line. Centralized here so the calc lives
 * in one place — the previous duplication across 4 files diverged on
 * "bi-weekly" detection (string-includes "week" matched bi-weekly too,
 * giving it a wrong +6 instead of +13).
 */
export function canonicalEndForSchedule(
  startDate: string,
  storedEndDate: string,
  scheduleKind: string | null | undefined,
): string {
  if (scheduleKind !== "WEEKLY") return storedEndDate;
  const start = parseDay(startDate);
  const canonical = formatDay(addDays(start, 6));
  return canonical > storedEndDate ? canonical : storedEndDate;
}

/**
 * String-name variant for callers that only have the schedule's name
 * (not period_kind). Strict on the name: only matches when "week" is
 * the leading token (so "Bi-weekly" / "Monthly" don't match).
 */
export function canonicalEndForScheduleName(
  startDate: string,
  storedEndDate: string,
  scheduleName: string | null | undefined,
): string {
  if (!scheduleName) return storedEndDate;
  const lower = scheduleName.toLowerCase();
  // "Weekly" but not "Bi-weekly" / "Semi-monthly" / "Monthly".
  if (
    lower.includes("bi") ||
    lower.includes("semi") ||
    !lower.includes("week")
  ) {
    return storedEndDate;
  }
  return canonicalEndForSchedule(startDate, storedEndDate, "WEEKLY");
}

/**
 * Full calendar month containing `date` (1st → last day).
 * Used for MONTHLY schedules and for SEMI_MONTHLY time accumulation
 * (owner: same Time-grid rules as monthly; payroll runs at month-end).
 */
export function getMonthlyCalendarBounds(date: string): PeriodBounds {
  const target = parseDay(date);
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    startDate: formatDay(new Date(Date.UTC(y, m, 1))),
    endDate: formatDay(new Date(Date.UTC(y, m, lastDay))),
  };
}

/**
 * Semi-monthly bounds: the 1st-15th, then the 16th-end-of-month. Two pay
 * periods per month. (This previously returned full-month bounds; the owner
 * confirmed semi-monthly is a true twice-monthly split.)
 */
export function getSemiMonthlyBounds(date: string): PeriodBounds {
  const target = parseDay(date);
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  const dom = target.getUTCDate();
  if (dom <= 15) {
    return {
      startDate: formatDay(new Date(Date.UTC(y, m, 1))),
      endDate: formatDay(new Date(Date.UTC(y, m, 15))),
    };
  }
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    startDate: formatDay(new Date(Date.UTC(y, m, 16))),
    endDate: formatDay(new Date(Date.UTC(y, m, lastDay))),
  };
}
