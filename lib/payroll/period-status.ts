// Where a pay period sits in its lifecycle relative to today.
//
// The periods manager lists OPEN and LOCKED periods as bare date ranges,
// which forces the admin to mentally diff dates against today to know
// which row needs attention. This module names that judgement once:
//
//   RUNNING           OPEN and today falls inside the range — punches are
//                     still coming in; nothing to do yet.
//   NEEDS_PROCESSING  OPEN but the range has ended — every punch is in,
//                     the period is waiting on review + lock.
//   AWAITING_PAYMENT  LOCKED — reviewed and frozen, waiting to be paid.
//   UPCOMING          OPEN and the range hasn't started yet.
//
// Dates are YYYY-MM-DD strings in the company timezone, so plain string
// comparison is correct and no Date parsing (or DST hazard) is needed.

export type PeriodPhase =
  | "RUNNING"
  | "NEEDS_PROCESSING"
  | "AWAITING_PAYMENT"
  | "UPCOMING";

export function resolvePeriodPhase(input: {
  startDate: string;
  endDate: string;
  state: string;
  today: string;
}): PeriodPhase {
  if (input.state === "LOCKED") return "AWAITING_PAYMENT";
  if (input.today < input.startDate) return "UPCOMING";
  if (input.today > input.endDate) return "NEEDS_PROCESSING";
  return "RUNNING";
}

/** Sort weight: rows that need the admin's hands come first. */
export const PHASE_PRIORITY: Record<PeriodPhase, number> = {
  NEEDS_PROCESSING: 0,
  AWAITING_PAYMENT: 1,
  RUNNING: 2,
  UPCOMING: 3,
};

/**
 * 1-based day counter for an in-flight period ("day 3 of 7").
 * Returns null when today is outside the range.
 */
export function periodProgress(
  startDate: string,
  endDate: string,
  today: string,
): { day: number; total: number } | null {
  if (today < startDate || today > endDate) return null;
  const toUtc = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1);
  };
  const DAY_MS = 86_400_000;
  const total = Math.round((toUtc(endDate) - toUtc(startDate)) / DAY_MS) + 1;
  const day = Math.round((toUtc(today) - toUtc(startDate)) / DAY_MS) + 1;
  return { day, total };
}
