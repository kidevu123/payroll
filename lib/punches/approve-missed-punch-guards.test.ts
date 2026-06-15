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
