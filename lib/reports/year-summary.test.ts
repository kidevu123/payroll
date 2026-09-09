import { describe, expect, it } from "vitest";
import { computeYearSummary, type YearRowInput } from "./year-summary";

const row = (over: Partial<YearRowInput> & { periodId: string; endDate: string }): YearRowInput => ({
  scheduleName: "Weekly",
  grossPayCents: 100_00,
  amountCents: 100_00,
  replacedRunNetCents: 0,
  docNetPayCents: 0,
  tempLaborCents: 0,
  periodState: "PAID",
  periodPaymentMethod: "BANK",
  ...over,
});

describe("computeYearSummary", () => {
  const rows: YearRowInput[] = [
    row({ periodId: "a", endDate: "2026-01-10" }),
    row({ periodId: "b", endDate: "2026-01-17", periodPaymentMethod: "CASH" }),
    row({ periodId: "c", endDate: "2026-03-05", periodState: "LOCKED", periodPaymentMethod: null, scheduleName: "Semi-monthly" }),
    row({ periodId: "p1", endDate: "2025-01-10", grossPayCents: 80_00, amountCents: 80_00 }),
    row({ periodId: "p2", endDate: "2025-06-10", grossPayCents: 999_00, amountCents: 999_00 }),
    // Two runs on one period: gross adds, net is the period's summed run total.
    row({ periodId: "d", endDate: "2026-02-01", grossPayCents: 10_00, amountCents: 10_00 }),
    row({ periodId: "d", endDate: "2026-02-01", grossPayCents: 5_00, amountCents: 5_00 }),
  ];

  it("attributes periods to the year they end in and buckets by month", () => {
    const s = computeYearSummary(rows, 2026, "2026-03-31");
    expect(s.periodCount).toBe(4);
    expect(s.months[0]).toEqual({ month: "Jan", grossCents: 200_00, netCents: 200_00 });
    expect(s.months[1]).toEqual({ month: "Feb", grossCents: 15_00, netCents: 15_00 });
    expect(s.months[2]?.grossCents).toBe(100_00);
    expect(s.months[11]?.grossCents).toBe(0);
  });

  it("splits pay methods by period state and method", () => {
    const s = computeYearSummary(rows, 2026, "2026-03-31");
    expect(s.byMethod.total).toBe(4);
    expect(s.byMethod.slices.map((x) => [x.key, x.periods, x.pct])).toEqual([
      ["BANK", 2, 50],
      ["CASH", 1, 25],
      ["UNPAID", 1, 25],
    ]);
  });

  it("groups by schedule, largest net first", () => {
    const s = computeYearSummary(rows, 2026, "2026-03-31");
    expect(s.bySchedule.map((x) => [x.name, x.periods])).toEqual([
      ["Weekly", 3],
      ["Semi-monthly", 1],
    ]);
  });

  it("compares against the prior year through the same date only", () => {
    // Through Mar 31: 2026 = 315.00, 2025 = 80.00 (the June 2025 row is excluded).
    const s = computeYearSummary(rows, 2026, "2026-03-31");
    expect(s.comparison.grossCents).toBe(315_00);
    expect(s.comparison.grossDeltaPct).toBe(293.8);
    expect(s.comparison.priorYear).toBe(2025);
  });

  it("reports no delta when the prior year is empty", () => {
    const s = computeYearSummary(rows, 2025, "2025-12-31");
    expect(s.comparison.grossDeltaPct).toBeNull();
    expect(s.comparison.netDeltaPct).toBeNull();
  });
});
