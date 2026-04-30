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

  it("NEAREST_DOLLAR rounds to whole dollars with banker's tie-break", () => {
    expect(roundCents(0, "NEAREST_DOLLAR")).toBe(0);
    expect(roundCents(149, "NEAREST_DOLLAR")).toBe(100);
    expect(roundCents(151, "NEAREST_DOLLAR")).toBe(200);
    // Exactly half — even multiple wins.
    expect(roundCents(150, "NEAREST_DOLLAR")).toBe(200); // 1.50 -> 2 (even)
    expect(roundCents(250, "NEAREST_DOLLAR")).toBe(200); // 2.50 -> 2 (even)
    expect(roundCents(350, "NEAREST_DOLLAR")).toBe(400); // 3.50 -> 4 (even)
    expect(roundCents(450, "NEAREST_DOLLAR")).toBe(400); // 4.50 -> 4 (even)
  });

  it("NEAREST_QUARTER rounds to nearest $0.25 with banker's tie-break", () => {
    expect(roundCents(0, "NEAREST_QUARTER")).toBe(0);
    expect(roundCents(11, "NEAREST_QUARTER")).toBe(0);
    expect(roundCents(13, "NEAREST_QUARTER")).toBe(25);
    expect(roundCents(36, "NEAREST_QUARTER")).toBe(25);
    expect(roundCents(38, "NEAREST_QUARTER")).toBe(50);
    // Exactly half (12.5 cents into a 25-quantum) — even multiple wins.
    // 12 -> nearest is 0 since 12 < 12.5; 13 -> 25.
    // For exact 12.5 we'd need fractional cents; integer cents make exact-half rare,
    // but exercise the path: 75 vs 50 at remainder 12.5 only happens at 62 or 87.
    // 62: q=2 (50), remainder 12 (< half 12.5) -> stays 50.
    expect(roundCents(62, "NEAREST_QUARTER")).toBe(50);
    expect(roundCents(63, "NEAREST_QUARTER")).toBe(75);
  });

  it("bankersRound's even-tie path is exercised when the half is integral", () => {
    // Use NEAREST_DOLLAR (quantum=100, half=50) where remainder == half is reachable.
    expect(roundCents(50, "NEAREST_DOLLAR")).toBe(0); // q=0 (even)
    expect(roundCents(150, "NEAREST_DOLLAR")).toBe(200); // q=1 (odd) -> 2
    expect(roundCents(2050, "NEAREST_DOLLAR")).toBe(2000); // q=20 (even)
    expect(roundCents(2150, "NEAREST_DOLLAR")).toBe(2200); // q=21 (odd) -> 22
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
