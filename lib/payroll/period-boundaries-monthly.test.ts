import { describe, expect, it } from "vitest";
import {
  getMonthlyCalendarBounds,
  getSemiMonthlyBounds,
} from "@/lib/payroll/period-boundaries";
import { periodBoundsForSchedule } from "@/lib/db/queries/pay-periods";

describe("monthly calendar bounds", () => {
  it("covers full May 2026", () => {
    expect(getMonthlyCalendarBounds("2026-05-12")).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
  });

  it("semi-monthly splits into 1-15 and 16-end", () => {
    expect(getSemiMonthlyBounds("2026-05-12")).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-15",
    });
    expect(getSemiMonthlyBounds("2026-05-15")).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-15",
    });
    expect(getSemiMonthlyBounds("2026-05-20")).toEqual({
      startDate: "2026-05-16",
      endDate: "2026-05-31",
    });
    // February end-of-month lands on the 28th, not the 31st.
    expect(getSemiMonthlyBounds("2026-02-20")).toEqual({
      startDate: "2026-02-16",
      endDate: "2026-02-28",
    });
  });

  it("periodBoundsForSchedule gives SEMI_MONTHLY its own half, distinct from MONTHLY", () => {
    const semiLate = periodBoundsForSchedule("2026-05-20", {
      periodKind: "SEMI_MONTHLY",
      anchorDate: null,
    });
    const semiEarly = periodBoundsForSchedule("2026-05-08", {
      periodKind: "SEMI_MONTHLY",
      anchorDate: null,
    });
    const monthly = periodBoundsForSchedule("2026-05-20", {
      periodKind: "MONTHLY",
      anchorDate: null,
    });
    expect(semiEarly).toEqual({ startDate: "2026-05-01", endDate: "2026-05-15" });
    expect(semiLate).toEqual({ startDate: "2026-05-16", endDate: "2026-05-31" });
    expect(monthly).toEqual({ startDate: "2026-05-01", endDate: "2026-05-31" });
    expect(semiLate).not.toEqual(monthly);
  });
});
