import { describe, expect, it } from "vitest";
import {
  daysWithoutPunches,
  listFixableDays,
  safeFixReturnPath,
} from "./fixable-days";

const week = { startDate: "2026-10-05", endDate: "2026-10-11" };

describe("listFixableDays", () => {
  it("lists every day of a finished week, marking the ones with punches", () => {
    const days = listFixableDays({
      ...week,
      today: "2026-10-13",
      punchDays: new Set(["2026-10-07", "2026-10-08", "2026-10-09"]),
      pendingDays: new Set(),
    });
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
      "2026-10-09", "2026-10-10", "2026-10-11",
    ]);
    expect(daysWithoutPunches(days).map((d) => d.date)).toEqual([
      "2026-10-05", "2026-10-06", "2026-10-10", "2026-10-11",
    ]);
  });

  it("stops at today while the week is still running", () => {
    const days = listFixableDays({
      ...week,
      today: "2026-10-07",
      punchDays: new Set(),
      pendingDays: new Set(),
    });
    expect(days.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
  });

  it("is empty for a week that has not started", () => {
    expect(
      listFixableDays({ ...week, today: "2026-10-01", punchDays: new Set(), pendingDays: new Set() }),
    ).toEqual([]);
  });

  it("flags days that already have a fix waiting", () => {
    const days = listFixableDays({
      ...week,
      today: "2026-10-13",
      punchDays: new Set(),
      pendingDays: new Set(["2026-10-05"]),
    });
    expect(days[0]).toEqual({ date: "2026-10-05", hasPunches: false, pending: true });
    expect(days[1]?.pending).toBe(false);
  });
});

describe("safeFixReturnPath", () => {
  it("accepts a payslip page and the time page", () => {
    const pay = "/me/pay/29fc4748-9c47-423a-a3c0-32f82fca3978";
    expect(safeFixReturnPath(pay)).toBe(pay);
    expect(safeFixReturnPath("/me/time")).toBe("/me/time");
  });

  it("rejects anything else", () => {
    expect(safeFixReturnPath("https://evil.example/me/pay/x")).toBeNull();
    expect(safeFixReturnPath("//evil.example")).toBeNull();
    expect(safeFixReturnPath("/me/pay/29fc4748-9c47-423a-a3c0-32f82fca3978/../../x")).toBeNull();
    expect(safeFixReturnPath("/payroll")).toBeNull();
    expect(safeFixReturnPath("")).toBeNull();
    expect(safeFixReturnPath(null)).toBeNull();
  });
});
