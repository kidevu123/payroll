import { describe, expect, it } from "vitest";
import { buildEmployeeReportFixMode } from "./employee-report-mode";

describe("buildEmployeeReportFixMode", () => {
  const timezone = "America/New_York";
  const date = "2026-06-09";

  it("asks only for clock-out when the day has an open clock-in", () => {
    const mode = buildEmployeeReportFixMode({
      date,
      timezone,
      punches: [
        {
          clockIn: new Date("2026-06-09T13:05:00.000Z"),
          clockOut: null,
          notes: null,
          voidedAt: null,
        },
      ],
    });

    expect(mode.kind).toBe("MISSING_OUT");
    expect(mode.recordedClockIn).toBe("9:05 AM");
    expect(mode.defaultClockIn).toBeUndefined();
    expect(mode.defaultClockOut).toBe("2026-06-09T17:05");
  });

  it("asks only for clock-in when the day has an out-only sentinel", () => {
    const mode = buildEmployeeReportFixMode({
      date,
      timezone,
      punches: [
        {
          clockIn: new Date("2026-06-09T22:10:00.000Z"),
          clockOut: new Date("2026-06-09T22:10:00.000Z"),
          notes: null,
          voidedAt: null,
        },
      ],
    });

    expect(mode.kind).toBe("MISSING_IN");
    expect(mode.recordedClockOut).toBe("6:10 PM");
    expect(mode.defaultClockIn).toBe("2026-06-09T08:00");
    expect(mode.defaultClockOut).toBeUndefined();
  });

  it("starts a correction from the one completed shift on file", () => {
    const mode = buildEmployeeReportFixMode({
      date: "2026-10-07",
      timezone: "America/New_York",
      punches: [
        {
          clockIn: new Date("2026-10-07T14:09:00Z"),
          clockOut: new Date("2026-10-07T22:29:00Z"),
        },
      ],
    });
    expect(mode.kind).toBe("NO_PUNCH_OR_CORRECTION");
    expect(mode.defaultClockIn).toBe("2026-10-07T10:09");
    expect(mode.defaultClockOut).toBe("2026-10-07T18:29");
    expect(mode.kind === "NO_PUNCH_OR_CORRECTION" && mode.onFileShift).toBeTruthy();
  });

  it("has no shift on file for a day with no punches", () => {
    const mode = buildEmployeeReportFixMode({
      date: "2026-10-05",
      timezone: "America/New_York",
      punches: [],
    });
    expect(mode.kind).toBe("NO_PUNCH_OR_CORRECTION");
    expect(mode.defaultClockOut).toBe("");
    expect(mode.kind === "NO_PUNCH_OR_CORRECTION" && mode.onFileShift).toBeFalsy();
  });

  it("does not guess which shift to correct when the day has two", () => {
    const mode = buildEmployeeReportFixMode({
      date: "2026-10-07",
      timezone: "America/New_York",
      punches: [
        { clockIn: new Date("2026-10-07T12:00:00Z"), clockOut: new Date("2026-10-07T16:00:00Z") },
        { clockIn: new Date("2026-10-07T17:00:00Z"), clockOut: new Date("2026-10-07T22:00:00Z") },
      ],
    });
    expect(mode.kind === "NO_PUNCH_OR_CORRECTION" && mode.onFileShift).toBeFalsy();
  });
});
