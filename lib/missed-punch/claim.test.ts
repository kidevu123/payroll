import { describe, expect, it } from "vitest";
import { parseMissedPunchClaim } from "./claim";

describe("parseMissedPunchClaim", () => {
  it("parses employee datetime-local values in the company timezone", () => {
    const result = parseMissedPunchClaim({
      claimedClockIn: "2026-05-26T08:00",
      claimedClockOut: "2026-05-26T17:30",
      timezone: "America/New_York",
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.clockIn?.toISOString()).toBe("2026-05-26T12:00:00.000Z");
      expect(result.clockOut?.toISOString()).toBe("2026-05-26T21:30:00.000Z");
    }
  });

  it("allows one-sided corrections but rejects empty submissions", () => {
    const outOnly = parseMissedPunchClaim({
      claimedClockOut: "2026-05-26T18:00",
      timezone: "America/New_York",
    });

    expect(outOnly).toMatchObject({ ok: true });
    if (outOnly.ok) {
      expect(outOnly.clockIn).toBeNull();
      expect(outOnly.clockOut?.toISOString()).toBe("2026-05-26T22:00:00.000Z");
    }

    expect(
      parseMissedPunchClaim({ timezone: "America/New_York" }),
    ).toEqual({ ok: false, error: "Enter at least one corrected punch time." });
  });

  it("rejects backwards ranges", () => {
    expect(
      parseMissedPunchClaim({
        claimedClockIn: "2026-05-26T18:00",
        claimedClockOut: "2026-05-26T08:00",
        timezone: "America/New_York",
      }),
    ).toEqual({ ok: false, error: "Clock-out must be after clock-in." });
  });
});

