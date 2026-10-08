
import { describe, expect, it } from "vitest";
import { nextWindowAfter, resolveFromMostRecent, gridLastDay } from "./period-select";

describe("nextWindowAfter", () => {
  it("weekly: the 7 days after the previous end", () => {
    expect(nextWindowAfter("2026-10-04", "WEEKLY")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });
  it("biweekly: 14 days", () => {
    expect(nextWindowAfter("2026-10-04", "BIWEEKLY")).toEqual({ start: "2026-10-05", end: "2026-10-18" });
  });
  it("monthly and semi-monthly: the calendar month after the one containing prevEnd + 1 day", () => {
    // A period that ends mid-month (semi-monthly 1st-15th) rolls to the next month.
    expect(nextWindowAfter("2026-10-15", "SEMI_MONTHLY")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(nextWindowAfter("2026-12-15", "MONTHLY")).toEqual({ start: "2027-01-01", end: "2027-01-31" });
  });
  it("KNOWN QUIRK, pinned not endorsed: a period ending on the last day of a month skips a month", () => {
    // prevEnd + 1 day is already the 1st of the next month, and the rule then
    // adds another month. After Nov 30 this returns January, not December.
    // Behaviour preserved as-is by the refactor; changing it is a product
    // decision (see CLAUDE.md, giant-files split part 1).
    expect(nextWindowAfter("2026-11-30", "MONTHLY")).toEqual({ start: "2027-01-01", end: "2027-01-31" });
    expect(nextWindowAfter("2026-12-31", "SEMI_MONTHLY")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
  });
});

const base = { id: "p1", startDate: "2026-09-28", endDate: "2026-10-04", payScheduleId: "s1" };

describe("resolveFromMostRecent", () => {
  it("an OPEN period is used as-is", () => {
    expect(resolveFromMostRecent({ ...base, state: "OPEN", kind: "WEEKLY" }, "2026-10-06", "WEEKLY")).toMatchObject({ id: "p1", state: "OPEN" });
  });
  it("a locked period that still covers today is used", () => {
    expect(resolveFromMostRecent({ ...base, state: "LOCKED", kind: "WEEKLY" }, "2026-10-04", "WEEKLY")).toMatchObject({ id: "p1", state: "LOCKED" });
  });
  it("a locked period that ended rolls forward to a synthetic next window", () => {
    expect(resolveFromMostRecent({ ...base, state: "PAID", kind: "WEEKLY" }, "2026-10-06", "WEEKLY")).toEqual({ id: "", startDate: "2026-10-05", endDate: "2026-10-11", payScheduleId: "s1", state: "UPCOMING" });
  });
  it("with no tab filter the period's own kind drives the roll, defaulting to weekly", () => {
    expect(resolveFromMostRecent({ ...base, state: "PAID", kind: "MONTHLY" }, "2026-10-06", null).endDate).toBe("2026-11-30");
    expect(resolveFromMostRecent({ ...base, state: "PAID", kind: null }, "2026-10-06", null).endDate).toBe("2026-10-11");
  });
});

describe("gridLastDay", () => {
  it("widens a short stored range to a full seven days", () => {
    expect(gridLastDay({ startDate: "2026-10-05", endDate: "2026-10-09" })).toBe("2026-10-11");
  });
  it("keeps a range that is already seven days or longer", () => {
    expect(gridLastDay({ startDate: "2026-10-01", endDate: "2026-10-31" })).toBe("2026-10-31");
  });
});
