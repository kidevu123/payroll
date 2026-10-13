// Which days of a pay period an employee can ask to have fixed, and in what
// state each one is. Pure: the pages pass in what they already loaded.

import { eachDayIso } from "@/lib/time/format";

export type FixableDay = {
  /** YYYY-MM-DD in the company timezone. */
  date: string;
  /** At least one live punch on file for the day. */
  hasPunches: boolean;
  /** A fix for this day is already waiting on the office. */
  pending: boolean;
};

/**
 * Every day of the period that has already started, oldest first. Days after
 * `today` are left out: nobody can have missed a punch on a day that has not
 * happened yet.
 */
export function listFixableDays(args: {
  startDate: string;
  endDate: string;
  today: string;
  punchDays: ReadonlySet<string>;
  pendingDays: ReadonlySet<string>;
}): FixableDay[] {
  const last = args.endDate < args.today ? args.endDate : args.today;
  if (last < args.startDate) return [];
  return eachDayIso(args.startDate, last).map((date) => ({
    date,
    hasPunches: args.punchDays.has(date),
    pending: args.pendingDays.has(date),
  }));
}

/** The days with nothing on file: the ones an employee may need to add. */
export function daysWithoutPunches(days: readonly FixableDay[]): FixableDay[] {
  return days.filter((d) => !d.hasPunches);
}

const RETURN_TO_PAYSLIP = /^\/me\/pay\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where to send the employee after they submit a fix. Only two in-app
 * destinations are accepted, so a crafted link cannot turn the form into an
 * open redirect.
 */
export function safeFixReturnPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "/me/time") return value;
  return RETURN_TO_PAYSLIP.test(value) ? value : null;
}
