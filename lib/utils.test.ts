// Smoke test — proves the test runner works end to end. Real coverage starts
// landing in Phase 1 against /lib/payroll/computePay.

import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatHours,
  formatTimeShort,
  formatHoursMinutes,
} from "./utils";

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

describe("formatTimeShort", () => {
  // 2026-04-21T11:32:00Z is 7:32a in America/New_York (EDT).
  const date = new Date("2026-04-21T11:32:00.000Z");

  it("returns compact 12-hour clock label in the company timezone", () => {
    expect(formatTimeShort(date, "America/New_York")).toBe("7:32a");
  });

  it("uses 'p' for PM hours", () => {
    // 16:11 UTC → 12:11p ET on the same date.
    const pm = new Date("2026-04-21T16:11:00.000Z");
    expect(formatTimeShort(pm, "America/New_York")).toBe("12:11p");
  });

  it("respects the requested timezone, not the JS host", () => {
    // 7:32a Eastern is 12:32p UTC.
    expect(formatTimeShort(date, "UTC")).toBe("11:32a");
  });
});

describe("formatHoursMinutes", () => {
  it("renders zero/empty inputs as '0h'", () => {
    expect(formatHoursMinutes(0)).toBe("0h");
    expect(formatHoursMinutes(-1)).toBe("0h");
    expect(formatHoursMinutes(NaN)).toBe("0h");
  });

  it("drops the minutes term when the hours land cleanly", () => {
    expect(formatHoursMinutes(8)).toBe("8h");
    expect(formatHoursMinutes(0.5)).toBe("30m");
  });

  it("renders mixed h/m without a leading zero", () => {
    expect(formatHoursMinutes(8.6)).toBe("8h 36m");
    expect(formatHoursMinutes(1.25)).toBe("1h 15m");
  });
});
