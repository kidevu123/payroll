import { describe, expect, it } from "vitest";
import type { Punch } from "@/lib/db/schema";
import {
  defaultClockOutGuess,
  findFixTarget,
  formatNgtecoSourceLine,
  formatWallClock,
  formatWallDate,
  toLocalInputValue,
} from "./editor-format";

const tz = "America/New_York";
const punch = (over: Partial<Punch>): Punch =>
  ({ id: "p", employeeId: "e", clockIn: new Date("2026-10-05T13:00:00Z"), clockOut: new Date("2026-10-05T21:00:00Z"), voidedAt: null, notes: null, ...over }) as Punch;

describe("toLocalInputValue", () => {
  it("renders a datetime-local value in the company zone, 24h", () => {
    expect(toLocalInputValue(new Date("2026-10-05T13:05:00Z"), tz)).toBe("2026-10-05T09:05");
    expect(toLocalInputValue("2026-10-06T03:30:00Z", tz)).toBe("2026-10-05T23:30");
    expect(toLocalInputValue(new Date("2026-10-05T04:00:00Z"), tz)).toBe("2026-10-05T00:00");
  });
  it("is empty for a missing time", () => {
    expect(toLocalInputValue(null, tz)).toBe("");
  });
});

describe("formatWallClock / formatWallDate", () => {
  it("clock time in the company zone", () => {
    expect(formatWallClock(new Date("2026-10-05T13:05:00Z"), tz)).toBe("9:05 AM");
  });
  it("labels the day of a wall-clock value", () => {
    expect(formatWallDate("2026-10-05T09:00", tz)).toBe("Mon, Oct 5");
  });
});

describe("defaultClockOutGuess", () => {
  it("is eight hours after the clock-in", () => {
    expect(defaultClockOutGuess(new Date("2026-10-05T13:05:00Z"), tz)).toBe("2026-10-05T17:05");
  });
});

describe("formatNgtecoSourceLine", () => {
  it("names the device and scrape time when the notes carry them", () => {
    expect(formatNgtecoSourceLine("dev:K40 · scrape:2026-10-05|09:00")).toBe("From NGTeco time clock · device K40 · scraped 2026-10-05 09:00");
  });
  it("falls back to the bare label", () => {
    expect(formatNgtecoSourceLine("manual")).toBe("From NGTeco time clock");
  });
});

describe("findFixTarget", () => {
  it("is null when every punch is complete", () => {
    expect(findFixTarget([punch({})])).toBeNull();
  });
  it("finds an open shift and ignores voided punches", () => {
    const open = punch({ id: "open", clockOut: null });
    expect(findFixTarget([punch({}), open])?.id).toBe("open");
    expect(findFixTarget([punch({ id: "v", clockOut: null, voidedAt: new Date() })])).toBeNull();
  });
});
