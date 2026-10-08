import { describe, expect, it } from "vitest";
import { formatWallClock, toDatetimeLocalValue, todayInCompanyTz } from "./format";
import { fmtRange } from "@/lib/pdf/doc-format";

const tz = "America/New_York";

describe("formatWallClock", () => {
  it("12-hour clock time in the given zone, from a Date or an ISO string", () => {
    expect(formatWallClock(new Date("2026-10-05T13:05:00Z"), tz)).toBe("9:05 AM");
    expect(formatWallClock("2026-10-05T21:30:00Z", tz)).toBe("5:30 PM");
  });
});

describe("toDatetimeLocalValue", () => {
  it("the value a datetime-local input wants, in the given zone", () => {
    expect(toDatetimeLocalValue(new Date("2026-10-05T13:05:00Z"), tz)).toBe("2026-10-05T09:05");
    expect(toDatetimeLocalValue(new Date("2026-10-06T03:30:00Z"), tz)).toBe("2026-10-05T23:30");
  });
});

describe("todayInCompanyTz", () => {
  it("matches the en-CA formatter the dashboard and employee home used", () => {
    for (const iso of ["2026-10-06T03:30:00Z", "2026-10-06T04:00:00Z", "2026-01-01T04:59:59Z", "2026-03-08T07:00:00Z"]) {
      const now = new Date(iso);
      expect(todayInCompanyTz(tz, now)).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now));
    }
  });
});

describe("fmtRange (PDF header)", () => {
  it("upper-case month abbreviations, year once at the end", () => {
    expect(fmtRange("2026-09-28", "2026-10-04")).toBe("SEP 28 - OCT 4, 2026");
    expect(fmtRange("2026-12-28T00:00:00Z", "2027-01-03")).toBe("DEC 28 - JAN 3, 2027");
  });
  it("falls back to the raw strings when either is not a date", () => {
    expect(fmtRange("soon", "2026-10-04")).toBe("soon - 2026-10-04");
  });
});
