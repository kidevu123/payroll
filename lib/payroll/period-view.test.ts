import { describe, expect, it } from "vitest";
import {
  ROUNDING_LABEL,
  formatDayLabel,
  formatHm,
  formatShortDate,
  periodDayCount,
  rateLabel,
} from "./period-view";

const tz = "America/New_York";

describe("formatHm", () => {
  it("formats a clock time in the company zone", () => {
    expect(formatHm(new Date("2026-10-05T13:00:00Z"), tz)).toBe("9:00 AM");
  });
  it("accepts a value that is not a Date instance", () => {
    expect(formatHm("2026-10-05T21:30:00Z" as unknown as Date, tz)).toBe("5:30 PM");
  });
  it("dashes a missing time", () => {
    expect(formatHm(null, tz)).toBe("—");
  });
});

describe("formatDayLabel / formatShortDate", () => {
  it("labels a calendar day without rolling it", () => {
    expect(formatDayLabel("2026-10-05", tz)).toBe("Mon, Oct 5");
  });
  it("short date from a Date or a string", () => {
    expect(formatShortDate(new Date("2026-10-05T16:00:00Z"), tz)).toBe("Oct 5");
    expect(formatShortDate("2026-10-05T16:00:00Z", tz)).toBe("Oct 5");
  });
});

describe("rateLabel", () => {
  it("hourly", () => {
    expect(rateLabel({ payType: "HOURLY", hourlyRateCents: 2200 })).toBe("$22.00/hr");
    expect(rateLabel({ payType: "HOURLY", hourlyRateCents: null })).toBe("—");
  });
  it("flat task", () => {
    expect(rateLabel({ payType: "FLAT_TASK", hourlyRateCents: 1500 })).toBe("Per task · $15.00");
    expect(rateLabel({ payType: "FLAT_TASK", hourlyRateCents: null })).toBe("Per task · —");
  });
});

describe("periodDayCount", () => {
  it("counts inclusively, across a month end and a DST change", () => {
    expect(periodDayCount("2026-09-28", "2026-10-04")).toBe(7);
    expect(periodDayCount("2026-10-01", "2026-10-31")).toBe(31);
    expect(periodDayCount("2026-03-02", "2026-03-15")).toBe(14);
    expect(periodDayCount("2026-10-05", "2026-10-05")).toBe(1);
  });
});

describe("ROUNDING_LABEL", () => {
  it("has plain-English copy for each rule", () => {
    expect(ROUNDING_LABEL.NEAREST_DOLLAR).toBe("Pay is rounded to the nearest dollar");
    expect(Object.keys(ROUNDING_LABEL).sort()).toEqual(["NEAREST_DOLLAR", "NEAREST_FIFTEEN_MIN_HOURS", "NEAREST_QUARTER", "NONE"]);
  });
});
