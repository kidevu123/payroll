import { describe, it, expect } from "vitest";
import { detectExceptions, type DetectInput } from "./detect-exceptions";

const PERIOD = { id: "P", startDate: "2026-04-13", endDate: "2026-04-19" }; // Mon..Sun
const TZ = "America/New_York";
const NOW = new Date("2026-04-19T23:00:00Z");

function base(): DetectInput {
  return {
    employees: [{ id: "E1", status: "ACTIVE" }],
    punches: [],
    timeOff: [],
    holidays: [],
    period: PERIOD,
    workingDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
    now: NOW,
    timezone: TZ,
    thresholds: { shortMinutes: 240, longMinutes: 840 },
  };
}

describe("detectExceptions", () => {
  it("emits NO_PUNCH for every working day with no punch", () => {
    const alerts = detectExceptions(base());
    // Mon-Sat = 6 days, all NO_PUNCH.
    expect(alerts).toHaveLength(6);
    expect(alerts.every((a) => a.issue === "NO_PUNCH")).toBe(true);
    expect(alerts.map((a) => a.date)).toEqual([
      "2026-04-13",
      "2026-04-14",
      "2026-04-15",
      "2026-04-16",
      "2026-04-17",
      "2026-04-18",
    ]);
  });

  it("skips Sundays when not in workingDays", () => {
    const alerts = detectExceptions(base());
    expect(alerts.find((a) => a.date === "2026-04-19")).toBeUndefined();
  });

  it("skips a day covered by approved time-off", () => {
    const input = base();
    input.timeOff = [
      { employeeId: "E1", startDate: "2026-04-15", endDate: "2026-04-16" },
    ];
    const alerts = detectExceptions(input);
    expect(alerts.find((a) => a.date === "2026-04-15" && a.issue === "NO_PUNCH")).toBeUndefined();
    expect(alerts.find((a) => a.date === "2026-04-16" && a.issue === "NO_PUNCH")).toBeUndefined();
  });

  it("skips a day that is a holiday", () => {
    const input = base();
    input.holidays = ["2026-04-15"];
    const alerts = detectExceptions(input);
    expect(alerts.find((a) => a.date === "2026-04-15" && a.issue === "NO_PUNCH")).toBeUndefined();
  });

  it("does not emit alerts for non-ACTIVE employees", () => {
    const input = base();
    input.employees = [{ id: "E1", status: "TERMINATED" }];
    expect(detectExceptions(input)).toHaveLength(0);
  });

  it("emits MISSING_OUT when a punch is incomplete and >18h old", () => {
    const input = base();
    const clockIn = new Date(NOW.getTime() - 19 * 60 * 60 * 1000);
    input.punches = [{ employeeId: "E1", clockIn, clockOut: null }];
    const alerts = detectExceptions(input);
    expect(alerts.some((a) => a.issue === "MISSING_OUT")).toBe(true);
  });

  it("does not emit MISSING_OUT when the incomplete punch is recent", () => {
    const input = base();
    const clockIn = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    input.punches = [{ employeeId: "E1", clockIn, clockOut: null }];
    const alerts = detectExceptions(input);
    expect(alerts.some((a) => a.issue === "MISSING_OUT")).toBe(false);
  });

  it("emits MISSING_IN for outOnly sentinel punches (clockIn === clockOut)", () => {
    const input = base();
    const t = new Date("2026-04-15T20:00:00Z");
    input.punches = [{ employeeId: "E1", clockIn: t, clockOut: t }];
    const alerts = detectExceptions(input);
    expect(alerts.some((a) => a.issue === "MISSING_IN")).toBe(true);
  });

  it("emits SUSPICIOUS_DURATION for a punch shorter than the threshold", () => {
    const input = base();
    const clockIn = new Date("2026-04-15T13:00:00Z");
    const clockOut = new Date(clockIn.getTime() + 60 * 60 * 1000); // 1 hour < 4h
    input.punches = [{ employeeId: "E1", clockIn, clockOut }];
    const alerts = detectExceptions(input);
    expect(alerts.some((a) => a.issue === "SUSPICIOUS_DURATION")).toBe(true);
  });

  it("emits SUSPICIOUS_DURATION for a punch longer than the threshold", () => {
    const input = base();
    const clockIn = new Date("2026-04-15T13:00:00Z");
    const clockOut = new Date(clockIn.getTime() + 16 * 60 * 60 * 1000); // 16h > 14h
    input.punches = [{ employeeId: "E1", clockIn, clockOut }];
    const alerts = detectExceptions(input);
    expect(alerts.some((a) => a.issue === "SUSPICIOUS_DURATION")).toBe(true);
  });

  it("does not emit SUSPICIOUS_DURATION for a punch within thresholds", () => {
    const input = base();
    const clockIn = new Date("2026-04-15T13:00:00Z");
    const clockOut = new Date(clockIn.getTime() + 8 * 60 * 60 * 1000);
    input.punches = [{ employeeId: "E1", clockIn, clockOut }];
    const alerts = detectExceptions(input);
    expect(alerts.some((a) => a.issue === "SUSPICIOUS_DURATION")).toBe(false);
  });

  it("ignores voided punches", () => {
    const input = base();
    const clockIn = new Date(NOW.getTime() - 19 * 60 * 60 * 1000);
    input.punches = [
      { employeeId: "E1", clockIn, clockOut: null, voidedAt: NOW },
    ];
    const alerts = detectExceptions(input);
    expect(alerts.some((a) => a.issue === "MISSING_OUT")).toBe(false);
  });

  it("does not stack SUSPICIOUS_DURATION when multiple bad punches exist on a day", () => {
    const input = base();
    const t1 = new Date("2026-04-15T08:00:00Z");
    const t2 = new Date("2026-04-15T17:00:00Z");
    input.punches = [
      { employeeId: "E1", clockIn: t1, clockOut: new Date(t1.getTime() + 30 * 60 * 1000) },
      { employeeId: "E1", clockIn: t2, clockOut: new Date(t2.getTime() + 30 * 60 * 1000) },
    ];
    const alerts = detectExceptions(input);
    const susp = alerts.filter((a) => a.date === "2026-04-15" && a.issue === "SUSPICIOUS_DURATION");
    expect(susp).toHaveLength(1);
  });

  it("does not stack MISSING_OUT when multiple incomplete punches exist on a day", () => {
    const input = base();
    const t1 = new Date(NOW.getTime() - 30 * 60 * 60 * 1000);
    const t2 = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
    input.punches = [
      { employeeId: "E1", clockIn: t1, clockOut: null },
      { employeeId: "E1", clockIn: t2, clockOut: null },
    ];
    const alerts = detectExceptions(input);
    const mo = alerts.filter((a) => a.issue === "MISSING_OUT");
    expect(mo).toHaveLength(1);
  });

  it("does not emit any alert when the day has a complete in-range punch", () => {
    const input = base();
    const clockIn = new Date("2026-04-15T13:00:00Z");
    const clockOut = new Date(clockIn.getTime() + 8 * 60 * 60 * 1000);
    input.punches = [{ employeeId: "E1", clockIn, clockOut }];
    const alerts = detectExceptions(input).filter(
      (a) => a.date === "2026-04-15",
    );
    expect(alerts).toHaveLength(0);
  });
});
