import { describe, it, expect } from "vitest";
import { getPeriodBounds, getNextPeriodBounds } from "./period-boundaries";
import type { PayPeriodSettings } from "@/lib/settings/schemas";

const S = (over: Partial<PayPeriodSettings> = {}): PayPeriodSettings => ({
  lengthDays: 7,
  startDayOfWeek: 1, // Monday
  workingDays: [1, 2, 3, 4, 5, 6],
  firstStartDate: null,
  ...over,
});

describe("getPeriodBounds — no anchor (week-of)", () => {
  it("Monday-start: target on Monday returns same Monday", () => {
    const b = getPeriodBounds("2026-04-13", S()); // 2026-04-13 is a Monday
    expect(b).toEqual({ startDate: "2026-04-13", endDate: "2026-04-19" });
  });

  it("Monday-start: target mid-week", () => {
    const b = getPeriodBounds("2026-04-16", S()); // Thursday
    expect(b).toEqual({ startDate: "2026-04-13", endDate: "2026-04-19" });
  });

  it("Sunday-start: target on Sunday returns same Sunday", () => {
    const b = getPeriodBounds("2026-04-12", S({ startDayOfWeek: 0 }));
    expect(b).toEqual({ startDate: "2026-04-12", endDate: "2026-04-18" });
  });

  it("Sunday-start: target on Saturday returns prior Sunday", () => {
    const b = getPeriodBounds("2026-04-18", S({ startDayOfWeek: 0 }));
    expect(b).toEqual({ startDate: "2026-04-12", endDate: "2026-04-18" });
  });

  it("respects shorter periods (lengthDays=1, daily)", () => {
    const b = getPeriodBounds("2026-04-15", S({ lengthDays: 1 }));
    expect(b).toEqual({ startDate: "2026-04-15", endDate: "2026-04-15" });
  });

  it("respects longer periods (lengthDays=14, biweekly)", () => {
    const b = getPeriodBounds("2026-04-16", S({ lengthDays: 14 }));
    // Anchor still on Monday-of-week; period extends 14 days.
    expect(b).toEqual({ startDate: "2026-04-13", endDate: "2026-04-26" });
  });
});

describe("getPeriodBounds — with anchor", () => {
  it("anchor + length aligns: target on anchor returns anchor period", () => {
    const b = getPeriodBounds("2026-01-05", S({ firstStartDate: "2026-01-05" }));
    expect(b).toEqual({ startDate: "2026-01-05", endDate: "2026-01-11" });
  });

  it("target several periods later", () => {
    const b = getPeriodBounds("2026-04-13", S({ firstStartDate: "2026-01-05" }));
    // 2026-01-05 + 14*7 = 2026-04-13.
    expect(b).toEqual({ startDate: "2026-04-13", endDate: "2026-04-19" });
  });

  it("target before anchor returns a negative-index period", () => {
    const b = getPeriodBounds("2025-12-31", S({ firstStartDate: "2026-01-05" }));
    expect(b).toEqual({ startDate: "2025-12-29", endDate: "2026-01-04" });
  });

  it("DST transition does not shift the period (UTC math is stable)", () => {
    // US DST forward-leap on 2026-03-08 (Sun). Anchor on 2026-03-02 (Mon),
    // length 7 — period containing 2026-03-08 should be the anchor period.
    const b = getPeriodBounds("2026-03-08", S({ firstStartDate: "2026-03-02" }));
    expect(b).toEqual({ startDate: "2026-03-02", endDate: "2026-03-08" });
  });

  it("leap-year February 29 is handled cleanly", () => {
    const b = getPeriodBounds("2024-02-29", S({ firstStartDate: "2024-02-26" }));
    expect(b).toEqual({ startDate: "2024-02-26", endDate: "2024-03-03" });
  });
});

describe("getNextPeriodBounds", () => {
  it("returns the immediate next period under the same settings", () => {
    const settings = S({ firstStartDate: "2026-01-05" });
    const cur = getPeriodBounds("2026-01-05", settings);
    const nxt = getNextPeriodBounds(cur, settings);
    expect(nxt).toEqual({ startDate: "2026-01-12", endDate: "2026-01-18" });
  });

  it("works without an anchor (week-stepping)", () => {
    const settings = S();
    const cur = getPeriodBounds("2026-04-15", settings);
    const nxt = getNextPeriodBounds(cur, settings);
    expect(nxt).toEqual({ startDate: "2026-04-20", endDate: "2026-04-26" });
  });
});

describe("getPeriodBounds — input validation", () => {
  it("rejects malformed date strings", () => {
    expect(() => getPeriodBounds("2026/04/13", S())).toThrow();
    expect(() => getPeriodBounds("not-a-date", S())).toThrow();
    expect(() => getPeriodBounds("2026-4-13", S())).toThrow();
  });

  it("rejects malformed firstStartDate when it would be parsed", () => {
    expect(() =>
      getPeriodBounds("2026-04-13", S({ firstStartDate: "bogus" })),
    ).toThrow();
  });
});
