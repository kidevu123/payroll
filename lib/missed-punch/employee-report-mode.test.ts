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
});
