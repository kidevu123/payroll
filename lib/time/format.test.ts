
import { describe, expect, it } from "vitest";
import { todayInCompanyTz, eachDayIso, utcDayIso, formatClockTime } from "./format";
import { companyDayIso } from "./company-day";

describe("todayInCompanyTz", () => {
  // The three former copies used Intl en-CA with only timeZone set. The
  // consolidated version must give the same key as companyDayIso.
  it("matches the en-CA incantation the copies used, either side of midnight ET", () => {
    for (const iso of ["2026-10-06T03:59:00Z", "2026-10-06T04:00:00Z", "2026-03-08T06:59:00Z", "2026-03-08T07:00:00Z"]) {
      const now = new Date(iso);
      const legacy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
      expect(todayInCompanyTz("America/New_York", now)).toBe(legacy);
      expect(todayInCompanyTz("America/New_York", now)).toBe(companyDayIso(now, "America/New_York"));
    }
  });
  it("defaults to the current instant", () => {
    expect(todayInCompanyTz("UTC")).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("eachDayIso", () => {
  it("is inclusive and crosses a month end", () => {
    expect(eachDayIso("2026-09-28", "2026-10-04")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });
  it("returns one day when start equals end, none when reversed", () => {
    expect(eachDayIso("2026-10-05", "2026-10-05")).toEqual(["2026-10-05"]);
    expect(eachDayIso("2026-10-06", "2026-10-05")).toEqual([]);
  });
  it("is unaffected by a DST change inside the range", () => {
    expect(eachDayIso("2026-03-07", "2026-03-09")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });
});

describe("utcDayIso", () => {
  it("formats from UTC fields with zero padding", () => {
    expect(utcDayIso(new Date("2026-01-05T23:59:59Z"))).toBe("2026-01-05");
    expect(utcDayIso(new Date("2026-10-06T00:00:00Z"))).toBe("2026-10-06");
  });
});

describe("formatClockTime", () => {
  it("renders the employee pages' format in en-US and es-MX", () => {
    const d = new Date("2026-10-06T13:05:00Z"); // 9:05 AM ET
    expect(formatClockTime(d, "America/New_York", "en-US")).toBe("9:05 AM");
    expect(formatClockTime(d, "America/New_York", "es-MX")).toMatch(/9:05/);
  });
  it("renders an em dash for null", () => {
    expect(formatClockTime(null, "America/New_York", "en-US")).toBe("—");
  });
});
