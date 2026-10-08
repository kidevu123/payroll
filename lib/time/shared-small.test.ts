import { describe, expect, it } from "vitest";
import { timeOf } from "@/lib/time/format";
import { asDate } from "@/lib/time/wall-clock";
import { shortRange } from "@/lib/payroll/format-period";
import { urlBase64ToBuffer } from "@/lib/notifications/url-base64";
import { isNavActive } from "@/components/admin/nav-active";
import { tzDayKey, tzTimeOfDay, buildDayInOut } from "@/lib/pdf/day-in-out";

describe("timeOf", () => {
  it("takes the time part of a datetime-local value, or the value itself", () => {
    expect(timeOf("2026-10-05T09:30")).toBe("09:30");
    expect(timeOf("09:30")).toBe("09:30");
    expect(timeOf("")).toBe("");
  });
});

describe("asDate", () => {
  it("passes a Date through and parses a string, without throwing on a bad one", () => {
    const d = new Date("2026-10-05T13:00:00Z");
    expect(asDate(d)).toBe(d);
    expect(asDate("2026-10-05T13:00:00Z").getTime()).toBe(d.getTime());
    expect(Number.isNaN(asDate("nope").getTime())).toBe(true);
  });
});

describe("shortRange", () => {
  it("month and day on both ends, no year", () => {
    expect(shortRange("2026-09-28", "2026-10-04")).toBe("Sep 28 – Oct 4");
  });
});

describe("urlBase64ToBuffer", () => {
  it("decodes URL-safe base64 with missing padding", () => {
    expect([...new Uint8Array(urlBase64ToBuffer("AQID"))]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(urlBase64ToBuffer("-_8"))]).toEqual([251, 255]);
  });
});

describe("isNavActive", () => {
  it("dashboard also owns the root path", () => {
    expect(isNavActive("/", "/dashboard")).toBe(true);
    expect(isNavActive("/dashboard", "/dashboard")).toBe(true);
  });
  it("matches a section and its sub-pages, not a look-alike prefix", () => {
    expect(isNavActive("/payroll/abc", "/payroll")).toBe(true);
    expect(isNavActive("/payroll-x", "/payroll")).toBe(false);
    expect(isNavActive("/time", "/payroll")).toBe(false);
  });
});

describe("pdf day helpers", () => {
  const tz = "America/New_York";
  it("tzTimeOfDay is HH:MM:SS in the zone, with midnight as 00", () => {
    expect(tzTimeOfDay(new Date("2026-10-05T13:05:09Z"), tz)).toBe("09:05:09");
    expect(tzTimeOfDay(new Date("2026-10-05T04:00:00Z"), tz)).toBe("00:00:00");
  });
  it("tzDayKey is the company calendar day", () => {
    expect(tzDayKey(new Date("2026-10-06T03:30:00Z"), tz)).toBe("2026-10-05");
  });
  it("buildDayInOut gives each day its earliest in and latest out", () => {
    const m = buildDayInOut(
      [
        { clockIn: new Date("2026-10-05T13:00:00Z"), clockOut: new Date("2026-10-05T17:00:00Z") },
        { clockIn: new Date("2026-10-05T18:00:00Z"), clockOut: new Date("2026-10-05T22:00:00Z") },
        { clockIn: new Date("2026-10-06T13:00:00Z"), clockOut: null },
      ],
      tz,
    );
    expect(m.get("2026-10-05")).toEqual({ inTime: "09:00:00", outTime: "18:00:00" });
  });
});
