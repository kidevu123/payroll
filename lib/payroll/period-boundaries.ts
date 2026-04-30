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
