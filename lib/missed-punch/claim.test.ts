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

  it("MISSING_OUT accepts clock-out only", () => {
    const result = parseMissedPunchClaim({
      issue: "MISSING_OUT",
      claimedClockOut: "2026-06-02T17:00",
      timezone: "America/New_York",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.clockIn).toBeNull();
      expect(result.clockOut).not.toBeNull();
    }
    expect(
      parseMissedPunchClaim({
        issue: "MISSING_OUT",
        claimedClockIn: "2026-06-02T08:00",
        claimedClockOut: "2026-06-02T17:00",
        timezone: "America/New_York",
      }).ok,
    ).toBe(false);
  });

  it("UNPAIRED_PUNCH accepts one missing side", () => {
    const inOnly = parseMissedPunchClaim({
      issue: "UNPAIRED_PUNCH",
      claimedClockIn: "2026-06-02T08:00",
      timezone: "America/New_York",
    });
    expect(inOnly).toMatchObject({ ok: true });

    const outOnly = parseMissedPunchClaim({
      issue: "UNPAIRED_PUNCH",
      claimedClockOut: "2026-06-02T17:00",
      timezone: "America/New_York",
    });
    expect(outOnly).toMatchObject({ ok: true });
  });

  it("UNPAIRED_PUNCH rejects replacing both sides", () => {
    expect(
      parseMissedPunchClaim({
        issue: "UNPAIRED_PUNCH",
        claimedClockIn: "2026-06-02T08:00",
        claimedClockOut: "2026-06-02T17:00",
        timezone: "America/New_York",
      }),
    ).toEqual({
      ok: false,
      error:
        "Only enter the one missing punch. The existing punch on file stays attached to the request.",
    });
  });

  it("MISSING_IN accepts clock-in only", () => {
    const result = parseMissedPunchClaim({
      issue: "MISSING_IN",
      claimedClockIn: "2026-06-02T08:00",
      timezone: "America/New_York",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.clockIn).not.toBeNull();
      expect(result.clockOut).toBeNull();
    }
  });

  it("anchors bare time-of-day claims to the report date", () => {
    // Phone-friendly <input type="time"> submits "HH:MM" with no date.
    const result = parseMissedPunchClaim({
      claimedClockIn: "08:00",
      claimedClockOut: "17:30",
      timezone: "America/New_York",
      date: "2026-05-26",
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.clockIn?.toISOString()).toBe("2026-05-26T12:00:00.000Z");
      expect(result.clockOut?.toISOString()).toBe("2026-05-26T21:30:00.000Z");
    }
  });

  it("anchors a one-sided bare time claim for UNPAIRED_PUNCH", () => {
    const result = parseMissedPunchClaim({
      issue: "UNPAIRED_PUNCH",
      claimedClockIn: "10:00",
      timezone: "America/New_York",
      date: "2026-07-13",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.clockIn?.toISOString()).toBe("2026-07-13T14:00:00.000Z");
      expect(result.clockOut).toBeNull();
    }
  });

  it("rejects a bare time claim without a date to anchor it", () => {
    expect(
      parseMissedPunchClaim({
        claimedClockIn: "08:00",
        timezone: "America/New_York",
      }),
    ).toEqual({ ok: false, error: "Invalid clock-in time." });
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
