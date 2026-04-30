// Smoke test — proves the test runner works end to end. Real coverage starts
// landing in Phase 1 against /lib/payroll/computePay.

import { describe, it, expect } from "vitest";
import { formatMoney, formatHours } from "./utils";

describe("formatMoney", () => {
  it("formats integer cents as USD", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(123)).toBe("$1.23");
    expect(formatMoney(125_000)).toBe("$1,250.00");
  });

  it("does not lose precision on rounding-prone values", () => {
    expect(formatMoney(99)).toBe("$0.99");
    expect(formatMoney(101)).toBe("$1.01");
  });
});

describe("formatHours", () => {
  it("respects the decimal-places argument", () => {
    expect(formatHours(40.0)).toBe("40.00");
    expect(formatHours(12.0599, 4)).toBe("12.0599");
    expect(formatHours(12.06, 0)).toBe("12");
  });
});
