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

  it("semi-monthly matches monthly (no 1-15 split)", () => {
    expect(getSemiMonthlyBounds("2026-05-12")).toEqual(
      getMonthlyCalendarBounds("2026-05-12"),
    );
    expect(getSemiMonthlyBounds("2026-05-20")).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
  });

  it("periodBoundsForSchedule aligns SEMI_MONTHLY with MONTHLY", () => {
    const semi = periodBoundsForSchedule("2026-05-20", {
      periodKind: "SEMI_MONTHLY",
      anchorDate: null,
    });
    const monthly = periodBoundsForSchedule("2026-05-20", {
      periodKind: "MONTHLY",
      anchorDate: null,
    });
    expect(semi).toEqual(monthly);
    expect(semi).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
  });
});
