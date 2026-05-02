// computePay — pure function from punches + task-pay + rate lookup +
// rules → fully-broken-out pay totals. Per spec §7.
//
// Invariants:
//   • All money in integer cents; never floats.
//   • Rate is "as of clockIn" — caller resolves via EmployeeRateHistory.
//   • Incomplete punches (null clockOut) contribute zero hours and zero
//     pay. They surface as exceptions; this module doesn't decide that —
//     it just doesn't pay them.
//   • Hours grouping by day uses the clockIn's calendar day in the company
//     timezone. The caller is responsible for converting timestamps before
//     passing them in (fixtures and integration callers use UTC offsets
//     that match the company tz).
//   • Overtime threshold (when configured) is per-period total hours.
//     Any portion over the threshold pays at the multiplier; all other
//     portions pay at base. The OT spillover is attributed to the day that
//     pushes total hours over the line, so byDay[].isOvertime marks the
//     first OT-affected day onward.

import {
  type RoundingRule,
  roundCents,
  roundDailyHours,
} from "./rounding";

export type ComputeInputPunch = {
  /** ISO 8601 timestamp string OR a Date. clockIn is required. */
  clockIn: string | Date;
  clockOut: string | Date | null;
  voidedAt?: string | Date | null;
};

export type ComputeInputTask = {
  amountCents: number;
};

export type ComputePayInput = {
  punches: ComputeInputPunch[];
  /** Returns the rate (in cents/hour) effective at the given punch's clockIn. */
  rateAt: (p: ComputeInputPunch) => number;
  taskPay: ComputeInputTask[];
  /**
   * IANA tz (e.g. "America/New_York") that day-keys are computed in. A punch
   * at 22:00 ET on Sunday converts to 02:00 UTC Monday — without explicit
   * timezone here we'd bucket those hours on Monday. Defaults to UTC for
   * back-compat with old fixtures.
   */
  timezone?: string;
  rules: {
    rounding: RoundingRule;
    hoursDecimalPlaces: number;
    overtime?: { thresholdHours: number; multiplier: number };
  };
};

export type ComputePayDay = {
  date: string;
  hours: number;
  cents: number;
  isOvertime: boolean;
};

export type ComputePayResult = {
  byDay: ComputePayDay[];
  totalHours: number;
  regularCents: number;
  overtimeCents: number;
  taskCents: number;
  grossCents: number;
  roundedCents: number;
};

const MS_PER_HOUR = 60 * 60 * 1000;

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function dayKey(d: Date, timezone: string | undefined): string {
  // When a timezone is supplied, format the wall-clock calendar day in that
  // zone via Intl. Without one, fall back to UTC for legacy fixtures (a 22:00
  // ET punch lands on the wrong day in production unless the caller passes
  // the company timezone).
  if (timezone) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
  }
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function roundHours(hours: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(hours * f) / f;
}

export function computePay(input: ComputePayInput): ComputePayResult {
  const { punches, rateAt, taskPay, rules, timezone } = input;

  type DayBucket = { date: string; hours: number; cents: number };
  const buckets = new Map<string, DayBucket & { rateSum: number; rateWeight: number }>();

  let regularCents = 0;
  for (const p of punches) {
    if (p.voidedAt) continue;
    if (!p.clockOut) continue; // incomplete — zero contribution.
    const inT = toDate(p.clockIn);
    const outT = toDate(p.clockOut);
    if (Number.isNaN(inT.getTime()) || Number.isNaN(outT.getTime())) continue;
    const ms = outT.getTime() - inT.getTime();
    if (ms <= 0) continue;
    const rawHours = ms / MS_PER_HOUR;
    const date = dayKey(inT, timezone);
    const rate = rateAt(p);
    const bucket = buckets.get(date) ?? {
      date,
      hours: 0,
      cents: 0,
      rateSum: 0,
      rateWeight: 0,
    };
    bucket.hours += rawHours;
    bucket.rateSum += rate * rawHours;
    bucket.rateWeight += rawHours;
    buckets.set(date, bucket);
  }

  // Apply daily-hours rounding (only NEAREST_FIFTEEN_MIN_HOURS does work).
  // Compute per-day cents at the (weighted) average rate of that day's punches.
  // For days with a single rate this is exact; for mid-day rate changes it
  // distributes proportionally, which matches the spec's "rate as of clockIn"
  // by punch since each punch contributed its own rate*hours into the sum.
  const ordered = [...buckets.values()].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );

  let totalHoursAccum = 0;
  const days: (ComputePayDay & { rate: number })[] = [];
  for (const b of ordered) {
    const dayHours = roundHours(roundDailyHours(b.hours, rules.rounding), rules.hoursDecimalPlaces);
    // rateWeight > 0 here because we only push to a bucket on positive ms.
    const avgRate = b.rateSum / b.rateWeight;
    const dayCents = Math.round(dayHours * avgRate);
    regularCents += dayCents;
    totalHoursAccum += dayHours;
    days.push({ date: b.date, hours: dayHours, cents: dayCents, isOvertime: false, rate: avgRate });
  }

  const totalHours = roundHours(totalHoursAccum, rules.hoursDecimalPlaces);

  // Overtime split (if configured): any hours over the threshold get an
  // extra (multiplier - 1) bump on top of the regular pay already counted.
  let overtimeCents = 0;
  if (rules.overtime?.thresholdHours !== undefined && rules.overtime.multiplier > 1) {
    const threshold = rules.overtime.thresholdHours;
    const mult = rules.overtime.multiplier;
    if (totalHours > threshold) {
      let cumulative = 0;
      for (const d of days) {
        const before = cumulative;
        cumulative += d.hours;
        if (cumulative <= threshold) continue;
        // Hours of this day that fall above the threshold.
        const otHours = cumulative - Math.max(threshold, before);
        const otBumpCents = Math.round(otHours * d.rate * (mult - 1));
        overtimeCents += otBumpCents;
        d.cents += otBumpCents;
        d.isOvertime = true;
      }
    }
  }

  const taskCents = taskPay.reduce((s, t) => s + t.amountCents, 0);
  const grossCents = regularCents + overtimeCents + taskCents;
  const roundedCents = roundCents(grossCents, rules.rounding);

  return {
    byDay: days.map(({ rate: _r, ...rest }) => rest),
    totalHours,
    regularCents,
    overtimeCents,
    taskCents,
    grossCents,
    roundedCents,
  };
}
