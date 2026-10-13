// Pure helpers for missed-punch approval — keep duplicate shifts off the books.

import { asDate } from "@/lib/time/wall-clock";

export type PunchDayRow = {
  clockIn: Date | string;
  clockOut: Date | string | null;
  voidedAt?: Date | string | null;
  notes?: string | null;
};

export function punchesForCalendarDay<T extends PunchDayRow>(
  rows: T[],
  day: string,
  dayKey: (d: Date) => string,
): T[] {
  return rows.filter(
    (p) => !p.voidedAt && dayKey(asDate(p.clockIn)) === day,
  );
}

/** Open shift that started on `day` (company TZ). */
export function findOpenPunchOnDay<T extends PunchDayRow>(
  forDay: T[],
  day: string,
  dayKey: (d: Date) => string,
): T | undefined {
  return forDay.find(
    (p) => !p.clockOut && dayKey(asDate(p.clockIn)) === day,
  );
}

export function dayHasClosedPunch<T extends PunchDayRow>(
  forDay: T[],
): boolean {
  return forDay.some((p) => p.clockOut);
}

export const DUPLICATE_SHIFT_ON_DAY =
  "approveMissedPunchRequest: day already has completed punches on file";

/**
 * The one completed shift on a day, when that is all the day holds. This is
 * the only case where an employee's corrected in/out can replace what is on
 * file without guessing: with two shifts, or an open or placeholder punch,
 * one corrected pair does not say which punch it means.
 */
export function soleClosedPunchOnDay<T extends PunchDayRow>(forDay: T[]): T | null {
  const live = forDay.filter((p) => !p.voidedAt);
  if (live.length !== 1) return null;
  const only = live[0]!;
  if (!only.clockOut) return null;
  if (asDate(only.clockOut).getTime() <= asDate(only.clockIn).getTime()) return null;
  return only;
}

/**
 * True when the day already carries real worked time: at least one live
 * punch with a clock-out after its clock-in. A zero-length placeholder
 * (clockIn === clockOut, the missing-clock-in marker) was paid as zero hours
 * and does not count.
 */
export function dayHasWorkedShift<T extends PunchDayRow>(forDay: T[]): boolean {
  return forDay.some(
    (p) =>
      !p.voidedAt &&
      !!p.clockOut &&
      asDate(p.clockOut).getTime() > asDate(p.clockIn).getTime(),
  );
}

export const CORRECTION_ON_PAID_DAY =
  "approveMissedPunchRequest: day is already paid with hours on file";
