import { describe, it, expect } from "vitest";
import { roundCents, roundDailyHours, type RoundingRule } from "./rounding";

describe("roundCents", () => {
  it("NONE is the identity", () => {
    expect(roundCents(0, "NONE")).toBe(0);
    expect(roundCents(12345, "NONE")).toBe(12345);
    expect(roundCents(-99, "NONE")).toBe(-99);
  });

  it("NEAREST_FIFTEEN_MIN_HOURS leaves cents alone (it rounds hours upstream)", () => {
    expect(roundCents(12345, "NEAREST_FIFTEEN_MIN_HOURS")).toBe(12345);
  });

  it("NEAREST_DOLLAR rounds to whole dollars half-up", () => {
    expect(roundCents(0, "NEAREST_DOLLAR")).toBe(0);
    expect(roundCents(149, "NEAREST_DOLLAR")).toBe(100);
    expect(roundCents(151, "NEAREST_DOLLAR")).toBe(200);
    // Exactly half — half-up always rounds away from zero.
    expect(roundCents(150, "NEAREST_DOLLAR")).toBe(200); // 1.50 -> 2
    expect(roundCents(250, "NEAREST_DOLLAR")).toBe(300); // 2.50 -> 3
    expect(roundCents(350, "NEAREST_DOLLAR")).toBe(400); // 3.50 -> 4
    expect(roundCents(450, "NEAREST_DOLLAR")).toBe(500); // 4.50 -> 5
  });

  it("NEAREST_QUARTER rounds to nearest $0.25 half-up", () => {
    expect(roundCents(0, "NEAREST_QUARTER")).toBe(0);
    expect(roundCents(11, "NEAREST_QUARTER")).toBe(0);
    expect(roundCents(13, "NEAREST_QUARTER")).toBe(25);
    expect(roundCents(36, "NEAREST_QUARTER")).toBe(25);
    expect(roundCents(38, "NEAREST_QUARTER")).toBe(50);
    // Integer-cent quantum=25 has half=12.5 which integers can't hit exactly,
    // so the half-up vs banker's distinction doesn't show here; just confirm
    // straightforward boundaries.
    expect(roundCents(62, "NEAREST_QUARTER")).toBe(50);
    expect(roundCents(63, "NEAREST_QUARTER")).toBe(75);
  });

  it("half-up always rounds .50 up (not to even)", () => {
    // The rule we just switched away from (banker's) would round 50, 250,
    // 2050 down to 0, 200, 2000. Half-up rounds them up. This is the
    // "underpay by $1 every $0.50" bug we shipped a fix for.
    expect(roundCents(50, "NEAREST_DOLLAR")).toBe(100);
    expect(roundCents(150, "NEAREST_DOLLAR")).toBe(200);
    expect(roundCents(2050, "NEAREST_DOLLAR")).toBe(2100);
    expect(roundCents(2150, "NEAREST_DOLLAR")).toBe(2200);
  });
});

describe("roundDailyHours", () => {
  it("only acts on NEAREST_FIFTEEN_MIN_HOURS", () => {
    const noOps: RoundingRule[] = ["NONE", "NEAREST_DOLLAR", "NEAREST_QUARTER"];
    for (const rule of noOps) {
      expect(roundDailyHours(7.43, rule)).toBe(7.43);
    }
  });

  it("rounds to nearest 0.25h with banker's tie-break", () => {
    const r: RoundingRule = "NEAREST_FIFTEEN_MIN_HOURS";
    expect(roundDailyHours(0, r)).toBe(0);
    expect(roundDailyHours(0.1, r)).toBe(0);
    expect(roundDailyHours(0.13, r)).toBe(0.25);
    expect(roundDailyHours(0.24, r)).toBe(0.25);
    // Exact-half: 0.125h is exactly between 0 and 0.25. Banker's: 0 (even).
    expect(roundDailyHours(0.125, r)).toBe(0);
    expect(roundDailyHours(0.375, r)).toBe(0.5); // between 0.25 and 0.5; tie -> 0.5 (even)
    expect(roundDailyHours(7.99, r)).toBe(8);
    expect(roundDailyHours(8.13, r)).toBe(8.25);
  });
});
