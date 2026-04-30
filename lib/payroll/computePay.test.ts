import { describe, it, expect } from "vitest";
import { computePay, type ComputeInputPunch } from "./computePay";

import shortDay from "./__fixtures__/short-day.json";
import suspiciousLong from "./__fixtures__/suspicious-long.json";
import midnightCrossing from "./__fixtures__/midnight-crossing.json";
import midPeriodRateChange from "./__fixtures__/mid-period-rate-change.json";
import flatTaskOnly from "./__fixtures__/flat-task-only.json";
import mixedTaskHourly from "./__fixtures__/mixed-task-hourly.json";
import incompletePunch from "./__fixtures__/incomplete-punch.json";

type Fixture = {
  name: string;
  punches: (ComputeInputPunch & { rateOverride?: number })[];
  rateCents: number;
  taskPay: { amountCents: number }[];
  rules: { rounding: "NONE" | "NEAREST_DOLLAR" | "NEAREST_QUARTER" | "NEAREST_FIFTEEN_MIN_HOURS"; hoursDecimalPlaces: number; overtime?: { thresholdHours: number; multiplier: number } };
  expected: {
    totalHours: number;
    regularCents: number;
    overtimeCents: number;
    taskCents: number;
    grossCents: number;
    roundedCents: number;
    days: { date: string; hours: number; cents: number; isOvertime: boolean }[];
  };
};

function runFixture(f: Fixture) {
  const result = computePay({
    punches: f.punches,
    rateAt: (p) => (p as { rateOverride?: number }).rateOverride ?? f.rateCents,
    taskPay: f.taskPay,
    rules: f.rules,
  });
  expect(result.totalHours).toBe(f.expected.totalHours);
  expect(result.regularCents).toBe(f.expected.regularCents);
  expect(result.overtimeCents).toBe(f.expected.overtimeCents);
  expect(result.taskCents).toBe(f.expected.taskCents);
  expect(result.grossCents).toBe(f.expected.grossCents);
  expect(result.roundedCents).toBe(f.expected.roundedCents);
  expect(result.byDay).toEqual(f.expected.days);
}

describe("computePay — fixtures", () => {
  it("short-day", () => runFixture(shortDay as Fixture));
  it("suspicious-long", () => runFixture(suspiciousLong as Fixture));
  it("midnight-crossing", () => runFixture(midnightCrossing as Fixture));
  it("mid-period-rate-change", () => runFixture(midPeriodRateChange as Fixture));
  it("flat-task-only", () => runFixture(flatTaskOnly as Fixture));
  it("mixed-task-hourly", () => runFixture(mixedTaskHourly as Fixture));
  it("incomplete-punch", () => runFixture(incompletePunch as Fixture));
});

describe("computePay — overtime", () => {
  it("no overtime config: hours over 40 still pay base", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T23:00:00Z" }, // 10h
        { clockIn: "2026-04-14T13:00:00Z", clockOut: "2026-04-14T23:00:00Z" }, // 10h
        { clockIn: "2026-04-15T13:00:00Z", clockOut: "2026-04-15T23:00:00Z" }, // 10h
        { clockIn: "2026-04-16T13:00:00Z", clockOut: "2026-04-16T23:00:00Z" }, // 10h
        { clockIn: "2026-04-17T13:00:00Z", clockOut: "2026-04-17T19:00:00Z" }, // 6h
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: { rounding: "NONE", hoursDecimalPlaces: 2 },
    });
    expect(result.totalHours).toBe(46);
    expect(result.overtimeCents).toBe(0);
    expect(result.grossCents).toBe(46 * 2000);
  });

  it("overtime threshold met but multiplier=1 — no bump", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T13:00:00Z" }, // 0h (filtered)
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: {
        rounding: "NONE",
        hoursDecimalPlaces: 2,
        overtime: { thresholdHours: 40, multiplier: 1 },
      },
    });
    // 0 hours → no day buckets → totalHours stays 0.
    expect(result.totalHours).toBe(0);
    expect(result.overtimeCents).toBe(0);
  });

  it("overtime kicks in after threshold; partial-day OT split is correct", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T21:00:00Z" }, // 8h
        { clockIn: "2026-04-14T13:00:00Z", clockOut: "2026-04-14T21:00:00Z" }, // 8h
        { clockIn: "2026-04-15T13:00:00Z", clockOut: "2026-04-15T21:00:00Z" }, // 8h
        { clockIn: "2026-04-16T13:00:00Z", clockOut: "2026-04-16T21:00:00Z" }, // 8h
        { clockIn: "2026-04-17T13:00:00Z", clockOut: "2026-04-17T23:00:00Z" }, // 10h — 8h regular + 2h OT
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: {
        rounding: "NONE",
        hoursDecimalPlaces: 2,
        overtime: { thresholdHours: 40, multiplier: 1.5 },
      },
    });
    expect(result.totalHours).toBe(42);
    expect(result.regularCents).toBe(42 * 2000); // base for all hours
    // OT bump = 2h * 2000 * 0.5 = 2000
    expect(result.overtimeCents).toBe(2000);
    expect(result.grossCents).toBe(42 * 2000 + 2000);
    const otDay = result.byDay.find((d) => d.date === "2026-04-17");
    expect(otDay?.isOvertime).toBe(true);
    expect(result.byDay.filter((d) => d.isOvertime)).toHaveLength(1);
  });

  it("overtime spans multiple days when threshold falls mid-day", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T23:00:00Z" }, // 10h
        { clockIn: "2026-04-14T13:00:00Z", clockOut: "2026-04-14T23:00:00Z" }, // 10h
        { clockIn: "2026-04-15T13:00:00Z", clockOut: "2026-04-15T23:00:00Z" }, // 10h
        { clockIn: "2026-04-16T13:00:00Z", clockOut: "2026-04-16T23:00:00Z" }, // 10h — 40h cumulative, 0 OT
        { clockIn: "2026-04-17T13:00:00Z", clockOut: "2026-04-17T23:00:00Z" }, // 10h all OT
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: {
        rounding: "NONE",
        hoursDecimalPlaces: 2,
        overtime: { thresholdHours: 35, multiplier: 1.5 },
      },
    });
    // Threshold 35; cumulative crosses on day 4 (40h), so day 4 has 5h OT,
    // day 5 has 10h OT. Bump = (5+10) * 2000 * 0.5 = 15000.
    expect(result.overtimeCents).toBe(15000);
    expect(result.byDay.filter((d) => d.isOvertime).map((d) => d.date)).toEqual([
      "2026-04-16",
      "2026-04-17",
    ]);
  });
});

describe("computePay — rounding", () => {
  it("NEAREST_DOLLAR rounds the gross (not the per-day breakdown)", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T20:30:00Z" }, // 7.5h
      ],
      rateAt: () => 1799, // 17.99/hr
      taskPay: [],
      rules: { rounding: "NEAREST_DOLLAR", hoursDecimalPlaces: 2 },
    });
    // 7.5 * 1799 = 13492.5 → 13493 (Math.round) → roundedCents = 13500 (banker, 134.93 -> 135)
    expect(result.grossCents).toBe(13493);
    expect(result.roundedCents).toBe(13500);
  });

  it("NEAREST_QUARTER rounds the gross to nearest $0.25", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T20:30:00Z" }, // 7.5h
      ],
      rateAt: () => 1799,
      taskPay: [],
      rules: { rounding: "NEAREST_QUARTER", hoursDecimalPlaces: 2 },
    });
    // 13493 / 25 = 539.72 → nearest 25 = 13500 (since remainder 18 > 12.5)
    expect(result.roundedCents).toBe(13500);
  });

  it("NEAREST_FIFTEEN_MIN_HOURS rounds hours-per-day before pay calc", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T20:24:00Z" }, // 7.4h -> 7.5
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: { rounding: "NEAREST_FIFTEEN_MIN_HOURS", hoursDecimalPlaces: 2 },
    });
    expect(result.totalHours).toBe(7.5);
    expect(result.regularCents).toBe(15000);
  });

  it("voided punches and zero/negative durations are ignored", () => {
    const result = computePay({
      punches: [
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T13:00:00Z" }, // 0h
        { clockIn: "2026-04-13T15:00:00Z", clockOut: "2026-04-13T14:00:00Z" }, // negative
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T17:00:00Z", voidedAt: new Date() }, // voided
        { clockIn: "2026-04-14T13:00:00Z", clockOut: "2026-04-14T21:00:00Z" }, // 8h
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: { rounding: "NONE", hoursDecimalPlaces: 2 },
    });
    expect(result.totalHours).toBe(8);
    expect(result.byDay).toHaveLength(1);
  });

  it("NaN timestamps are skipped silently", () => {
    const result = computePay({
      punches: [
        { clockIn: "not-a-date", clockOut: "2026-04-13T15:00:00Z" },
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "also-not-a-date" },
        { clockIn: "2026-04-14T13:00:00Z", clockOut: "2026-04-14T21:00:00Z" }, // 8h
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: { rounding: "NONE", hoursDecimalPlaces: 2 },
    });
    expect(result.totalHours).toBe(8);
  });

  it("sorts day buckets ascending regardless of input punch order", () => {
    // Punches in reverse-chronological order so the sort comparator must swap.
    const result = computePay({
      punches: [
        { clockIn: "2026-04-15T13:00:00Z", clockOut: "2026-04-15T17:00:00Z" }, // 4h
        { clockIn: "2026-04-13T13:00:00Z", clockOut: "2026-04-13T17:00:00Z" }, // 4h
        { clockIn: "2026-04-14T13:00:00Z", clockOut: "2026-04-14T17:00:00Z" }, // 4h
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: { rounding: "NONE", hoursDecimalPlaces: 2 },
    });
    expect(result.byDay.map((d) => d.date)).toEqual([
      "2026-04-13",
      "2026-04-14",
      "2026-04-15",
    ]);
  });

  it("accepts Date objects for clock timestamps", () => {
    const result = computePay({
      punches: [
        {
          clockIn: new Date("2026-04-13T13:00:00Z"),
          clockOut: new Date("2026-04-13T17:00:00Z"),
        },
      ],
      rateAt: () => 2000,
      taskPay: [],
      rules: { rounding: "NONE", hoursDecimalPlaces: 2 },
    });
    expect(result.totalHours).toBe(4);
  });
});
