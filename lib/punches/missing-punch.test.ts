import { describe, expect, it } from "vitest";
import {
  composeMissingWallClock,
  inferAmbiguousOnFileRole,
  validateAmbiguousPair,
} from "./missing-punch";

describe("inferAmbiguousOnFileRole", () => {
  it("defaults morning punches to clock-in", () => {
    const at = new Date("2026-06-05T11:00:00Z"); // 7:00 AM ET
    expect(inferAmbiguousOnFileRole(at, "America/New_York")).toBe("clock-in");
  });

  it("defaults afternoon punches to clock-out", () => {
    const at = new Date("2026-06-05T22:11:00Z"); // 6:11 PM ET
    expect(inferAmbiguousOnFileRole(at, "America/New_York")).toBe("clock-out");
  });
});

describe("validateAmbiguousPair", () => {
  const tz = "America/New_York";
  const onFileAt = new Date("2026-06-05T22:11:00Z"); // 6:11 PM ET
  const label = () => "6:11 PM";

  it("rejects morning time in clock-out field when on-file is clock-in", () => {
    expect(
      validateAmbiguousPair(
        "clock-in",
        "2026-06-05T18:11",
        "2026-06-05T06:00",
        tz,
        onFileAt,
        label,
      ),
    ).toMatch(/select Clock out/i);
  });

  it("accepts clock-out after on-file clock-in", () => {
    expect(
      validateAmbiguousPair(
        "clock-in",
        "2026-06-05T18:11",
        "2026-06-05T22:30",
        tz,
        onFileAt,
        label,
      ),
    ).toBeNull();
  });

  it("accepts morning clock-in when on-file is clock-out", () => {
    expect(
      validateAmbiguousPair(
        "clock-out",
        "2026-06-05T18:11",
        "2026-06-05T06:00",
        tz,
        onFileAt,
        label,
      ),
    ).toBeNull();
  });
});

describe("composeMissingWallClock", () => {
  it("uses the on-file punch's date when a clock-out time is later that day", () => {
    expect(
      composeMissingWallClock("clock-in", "2026-08-19T09:27", "17:05"),
    ).toEqual({ wallClock: "2026-08-19T17:05", dayOffset: 0 });
  });

  it("rolls a clock-out to the next day when it is earlier than the on-file clock-in", () => {
    expect(
      composeMissingWallClock("clock-in", "2026-08-19T22:00", "02:15"),
    ).toEqual({ wallClock: "2026-08-20T02:15", dayOffset: 1 });
  });

  it("uses the on-file punch's date when a clock-in time is earlier that day", () => {
    expect(
      composeMissingWallClock("clock-out", "2026-08-19T18:11", "09:30"),
    ).toEqual({ wallClock: "2026-08-19T09:30", dayOffset: 0 });
  });

  it("rolls a clock-in to the previous day when it is later than the on-file clock-out", () => {
    expect(
      composeMissingWallClock("clock-out", "2026-08-19T02:15", "22:00"),
    ).toEqual({ wallClock: "2026-08-18T22:00", dayOffset: -1 });
  });

  it("crosses month boundaries correctly", () => {
    expect(
      composeMissingWallClock("clock-in", "2026-08-31T23:00", "01:00"),
    ).toEqual({ wallClock: "2026-09-01T01:00", dayOffset: 1 });
  });

  it("returns null for an empty or malformed time", () => {
    expect(composeMissingWallClock("clock-in", "2026-08-19T09:27", "")).toBeNull();
    expect(composeMissingWallClock("clock-in", "2026-08-19T09:27", "5pm")).toBeNull();
    expect(composeMissingWallClock("clock-in", "not-a-date", "17:00")).toBeNull();
  });
});
