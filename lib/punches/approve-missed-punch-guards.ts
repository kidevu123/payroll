// Pure helpers for missed-punch approval — keep duplicate shifts off the books.

export type PunchDayRow = {
  clockIn: Date | string;
  clockOut: Date | string | null;
  voidedAt?: Date | string | null;
};

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

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
