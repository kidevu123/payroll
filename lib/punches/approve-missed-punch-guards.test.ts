import { describe, expect, it } from "vitest";
import {
  dayHasClosedPunch,
  findOpenPunchOnDay,
  punchesForCalendarDay,
} from "./approve-missed-punch-guards";

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

describe("approve-missed-punch-guards", () => {
  it("filters punches to the request calendar day", () => {
    const rows = [
      { clockIn: new Date("2026-06-09T10:00:00Z"), clockOut: null, voidedAt: null },
      { clockIn: new Date("2026-06-10T10:00:00Z"), clockOut: null, voidedAt: null },
    ];
    expect(punchesForCalendarDay(rows, "2026-06-09", dayKey)).toHaveLength(1);
  });

  it("finds an open punch on the day", () => {
    const open = {
      clockIn: new Date("2026-06-09T10:00:00Z"),
      clockOut: null,
      voidedAt: null,
    };
    const closed = {
      clockIn: new Date("2026-06-09T06:00:00Z"),
      clockOut: new Date("2026-06-09T18:00:00Z"),
      voidedAt: null,
    };
    expect(findOpenPunchOnDay([closed, open], "2026-06-09", dayKey)).toBe(open);
  });

  it("detects closed punches blocking a full-day insert", () => {
    const forDay = [
      {
        clockIn: new Date("2026-06-09T06:05:00Z"),
        clockOut: new Date("2026-06-09T22:04:00Z"),
        voidedAt: null,
      },
    ];
    expect(dayHasClosedPunch(forDay)).toBe(true);
  });
});

import { soleClosedPunchOnDay } from "./approve-missed-punch-guards";

describe("soleClosedPunchOnDay", () => {
  const closed = (inIso: string, outIso: string, notes: string | null = null) => ({
    clockIn: new Date(inIso),
    clockOut: new Date(outIso),
    voidedAt: null,
    notes,
  });

  it("returns the one completed shift on the day", () => {
    const shift = closed("2026-10-07T14:09:00Z", "2026-10-07T22:29:00Z");
    expect(soleClosedPunchOnDay([shift])).toBe(shift);
  });

  it("returns null when the day has no punches", () => {
    expect(soleClosedPunchOnDay([])).toBeNull();
  });

  it("returns null when the day has more than one punch", () => {
    // Two shifts: a single corrected in/out cannot say which one it replaces.
    expect(
      soleClosedPunchOnDay([
        closed("2026-10-07T12:00:00Z", "2026-10-07T16:00:00Z"),
        closed("2026-10-07T17:00:00Z", "2026-10-07T22:00:00Z"),
      ]),
    ).toBeNull();
  });

  it("returns null for an open shift", () => {
    expect(
      soleClosedPunchOnDay([
        { clockIn: new Date("2026-10-07T14:00:00Z"), clockOut: null, voidedAt: null, notes: null },
      ]),
    ).toBeNull();
  });

  it("returns null for a missing-clock-in placeholder", () => {
    // The placeholder stores clockIn === clockOut; it is completed by the
    // missing-clock-in path, not replaced as a correction.
    const out = "2026-10-07T22:00:00Z";
    expect(soleClosedPunchOnDay([closed(out, out)])).toBeNull();
  });
});

import { dayHasWorkedShift } from "./approve-missed-punch-guards";

describe("dayHasWorkedShift", () => {
  it("is true for a shift with real duration", () => {
    expect(
      dayHasWorkedShift([
        { clockIn: new Date("2026-10-06T12:00:00Z"), clockOut: new Date("2026-10-06T20:00:00Z"), voidedAt: null },
      ]),
    ).toBe(true);
  });

  it("is false for an empty day, an open shift, a voided shift and a zero-length placeholder", () => {
    const at = new Date("2026-10-06T20:00:00Z");
    expect(dayHasWorkedShift([])).toBe(false);
    expect(dayHasWorkedShift([{ clockIn: at, clockOut: null, voidedAt: null }])).toBe(false);
    expect(
      dayHasWorkedShift([
        { clockIn: new Date("2026-10-06T12:00:00Z"), clockOut: at, voidedAt: new Date() },
      ]),
    ).toBe(false);
    expect(dayHasWorkedShift([{ clockIn: at, clockOut: at, voidedAt: null }])).toBe(false);
  });
});
