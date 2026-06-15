import { describe, expect, it } from "vitest";
import {
  rankShiftsBySurvivor,
  shiftsAreNearDuplicates,
} from "./near-duplicate-shift";

describe("shiftsAreNearDuplicates", () => {
  it("matches Juan-style rescrape (IN 45s apart, same OUT)", () => {
    const a = {
      clockIn: new Date("2026-06-08T10:03:00.000Z"),
      clockOut: new Date("2026-06-08T22:00:00.000Z"),
    };
    const b = {
      clockIn: new Date("2026-06-08T10:03:45.000Z"),
      clockOut: new Date("2026-06-08T22:00:00.000Z"),
    };
    expect(shiftsAreNearDuplicates(a, b)).toBe(true);
  });

  it("matches poll vs CSV minute-rounded pair", () => {
    const poll = {
      clockIn: new Date("2026-06-08T10:17:21.000Z"),
      clockOut: new Date("2026-06-08T22:05:08.000Z"),
    };
    const csv = {
      clockIn: new Date("2026-06-08T10:17:00.000Z"),
      clockOut: new Date("2026-06-08T22:05:00.000Z"),
    };
    expect(shiftsAreNearDuplicates(poll, csv)).toBe(true);
  });

  it("does not match distinct shifts same day", () => {
    const morning = {
      clockIn: new Date("2026-06-08T10:00:00.000Z"),
      clockOut: new Date("2026-06-08T14:00:00.000Z"),
    };
    const evening = {
      clockIn: new Date("2026-06-08T18:00:00.000Z"),
      clockOut: new Date("2026-06-08T22:00:00.000Z"),
    };
    expect(shiftsAreNearDuplicates(morning, evening)).toBe(false);
  });
});

describe("rankShiftsBySurvivor", () => {
  it("prefers longer closed duration", () => {
    const short = {
      id: "a",
      clockIn: new Date("2026-06-08T10:03:00.000Z"),
      clockOut: new Date("2026-06-08T10:08:00.000Z"),
    };
    const long = {
      id: "b",
      clockIn: new Date("2026-06-08T10:03:45.000Z"),
      clockOut: new Date("2026-06-08T22:00:00.000Z"),
    };
    expect(rankShiftsBySurvivor([short, long])[0]!.id).toBe("b");
  });
});
