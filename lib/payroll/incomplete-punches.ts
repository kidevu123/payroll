// The open punches a period is warning about, with enough detail to go and
// fix each one. One definition, shared by the Pay Periods list (which shows
// the count) and the period page (which must show the punches themselves).
//
// "Incomplete" = clocked in, never clocked out, on a day that is already
// over. A shift still running today is not incomplete yet.

export type IncompletePunchInput = {
  id: string;
  employeeId: string;
  clockIn: Date | string;
  clockOut: Date | string | null;
  voidedAt?: Date | string | null;
};

export type IncompletePunch = {
  punchId: string;
  employeeId: string;
  /** "Unknown employee" when the punch belongs to nobody on file. */
  employeeName: string;
  /** YYYY-MM-DD in the company timezone: the day to open in the editor. */
  day: string;
  clockIn: Date;
};

export function listIncompletePunches(args: {
  punches: readonly IncompletePunchInput[];
  employeeNames: ReadonlyMap<string, string>;
  timezone: string;
  /** Start of today in the company timezone; punches from today are skipped. */
  todayStart: Date;
}): IncompletePunch[] {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: args.timezone });
  const out: IncompletePunch[] = [];
  for (const p of args.punches) {
    if (p.voidedAt || p.clockOut) continue;
    const clockIn = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    if (clockIn.getTime() >= args.todayStart.getTime()) continue;
    out.push({
      punchId: p.id,
      employeeId: p.employeeId,
      employeeName: args.employeeNames.get(p.employeeId) ?? "Unknown employee",
      day: dayFmt.format(clockIn),
      clockIn,
    });
  }
  return out.sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.employeeName.localeCompare(b.employeeName),
  );
}

/** Admin day editor for one employee's day in a period. */
export function incompletePunchFixHref(periodId: string, p: Pick<IncompletePunch, "day" | "employeeId">): string {
  return `/time/${periodId}/${p.day}/${p.employeeId}`;
}
