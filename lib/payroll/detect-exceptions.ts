// Missed-punch detection per spec §6.2. Pure function: takes employees,
// punches, holidays, time-off, and a period; returns the alerts that should
// be created. The caller persists them.
//
// Rules:
//   NO_PUNCH              ACTIVE employee, working day, no punch row, no
//                         approved time-off, not a holiday
//   MISSING_OUT           A punch exists with null clockOut and clockIn was
//                         more than 18 hours ago (relative to `now`)
//   MISSING_IN            Conceptually: clockOut without clockIn. Our schema
//                         requires clockIn, so this fires only when an
//                         imported NGTECO_AUTO row carries an out-only flag
//                         that the parser surfaces as a special punch with
//                         clockIn = clockOut.
//   SUSPICIOUS_DURATION   A complete punch's hours fall outside the
//                         configured short/long thresholds.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export type DetectInput = {
  /** ACTIVE employees only — the caller filters. */
  employees: { id: string; status: "ACTIVE" | "INACTIVE" | "TERMINATED" }[];
  punches: {
    employeeId: string;
    clockIn: Date;
    clockOut: Date | null;
    voidedAt?: Date | null;
  }[];
  /** Approved time-off rows that overlap the period. */
  timeOff: { employeeId: string; startDate: string; endDate: string }[];
  /** YYYY-MM-DD holidays. */
  holidays: string[];
  period: { id: string; startDate: string; endDate: string };
  /** Working days as ISO weekday numbers (0=Sun..6=Sat). */
  workingDays: number[];
  /** Anchor for "more than 18 hours ago" math. */
  now: Date;
  /** company.timezone — used to bucket clockIn into a calendar day. */
  timezone: string;
  thresholds: {
    /** SUSPICIOUS_DURATION fires when a punch's duration is below this many minutes. */
    shortMinutes: number;
    /** Or above this many minutes. */
    longMinutes: number;
  };
};

export type DetectedAlert = {
  employeeId: string;
  date: string; // YYYY-MM-DD in company tz
  issue:
    | "NO_PUNCH"
    | "MISSING_OUT"
    | "MISSING_IN"
    | "SUSPICIOUS_DURATION"
    | "INVERTED_TIMES";
};

/** Iterate days from startDate to endDate inclusive, both YYYY-MM-DD strings. */
function eachDay(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(formatDay(d));
  }
  return out;
}

function formatDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayInTimezone(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

function dayOfWeekInTimezone(iso: string): number {
  // Treat YYYY-MM-DD as a UTC midnight; UTC weekday is stable across host TZ.
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function withinTimeOff(
  iso: string,
  ranges: { startDate: string; endDate: string }[],
): boolean {
  return ranges.some((r) => iso >= r.startDate && iso <= r.endDate);
}

/**
 * Pure: returns the set of MissedPunchAlert rows that should exist. The
 * caller is responsible for diffing against any rows already persisted
 * (e.g. don't re-create an alert that's already resolved).
 */
export function detectExceptions(input: DetectInput): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  const days = eachDay(input.period.startDate, input.period.endDate);
  const holidaySet = new Set(input.holidays);
  const workingSet = new Set(input.workingDays);

  // Bucket non-voided punches by employee × day-in-company-tz.
  type Bucket = {
    complete: { ms: number }[];
    incomplete: { clockIn: Date }[];
    outOnly: number;
    /** clockOut < clockIn — produces 0 hours and silently underpays. */
    inverted: number;
  };
  const byEmpDay = new Map<string, Map<string, Bucket>>();
  for (const p of input.punches) {
    if (p.voidedAt) continue;
    const day = dayInTimezone(p.clockIn, input.timezone);
    let perEmp = byEmpDay.get(p.employeeId);
    if (!perEmp) {
      perEmp = new Map();
      byEmpDay.set(p.employeeId, perEmp);
    }
    const bucket = perEmp.get(day) ?? {
      complete: [],
      incomplete: [],
      outOnly: 0,
      inverted: 0,
    };
    if (p.clockOut === null) {
      bucket.incomplete.push({ clockIn: p.clockIn });
    } else if (p.clockOut.getTime() === p.clockIn.getTime()) {
      // Sentinel for an imported "clock-out without clock-in" record.
      bucket.outOnly += 1;
    } else if (p.clockOut.getTime() < p.clockIn.getTime()) {
      // Inverted: clock-out is before clock-in. computePay drops these
      // (ms <= 0 short-circuits) so the employee silently gets zero
      // hours. Surface as an exception so the admin can fix.
      bucket.inverted += 1;
    } else {
      bucket.complete.push({ ms: p.clockOut.getTime() - p.clockIn.getTime() });
    }
    perEmp.set(day, bucket);
  }

  // Time-off lookup grouped per-employee.
  const timeOffByEmp = new Map<string, { startDate: string; endDate: string }[]>();
  for (const t of input.timeOff) {
    const list = timeOffByEmp.get(t.employeeId) ?? [];
    list.push(t);
    timeOffByEmp.set(t.employeeId, list);
  }

  for (const e of input.employees) {
    if (e.status !== "ACTIVE") continue;
    const empBuckets = byEmpDay.get(e.id);
    const empTimeOff = timeOffByEmp.get(e.id) ?? [];
    for (const day of days) {
      const dow = dayOfWeekInTimezone(day);
      const isWorking = workingSet.has(dow);
      const isHoliday = holidaySet.has(day);
      const onTimeOff = withinTimeOff(day, empTimeOff);
      const bucket = empBuckets?.get(day);

      if (isWorking && !isHoliday && !onTimeOff && !bucket) {
        alerts.push({ employeeId: e.id, date: day, issue: "NO_PUNCH" });
        continue;
      }
      if (!bucket) continue;

      // MISSING_OUT — incomplete punch older than 18h relative to `now`.
      for (const inc of bucket.incomplete) {
        const ageMs = input.now.getTime() - inc.clockIn.getTime();
        if (ageMs > 18 * MS_PER_HOUR) {
          alerts.push({ employeeId: e.id, date: day, issue: "MISSING_OUT" });
          break; // one alert per day-employee — don't pile up
        }
      }

      if (bucket.outOnly > 0) {
        alerts.push({ employeeId: e.id, date: day, issue: "MISSING_IN" });
      }

      if (bucket.inverted > 0) {
        alerts.push({ employeeId: e.id, date: day, issue: "INVERTED_TIMES" });
      }

      // SUSPICIOUS_DURATION — any complete punch below short or above long.
      for (const c of bucket.complete) {
        const minutes = c.ms / 60_000;
        if (
          minutes < input.thresholds.shortMinutes ||
          minutes > input.thresholds.longMinutes
        ) {
          alerts.push({ employeeId: e.id, date: day, issue: "SUSPICIOUS_DURATION" });
          break;
        }
      }
    }
  }

  return alerts;
}
