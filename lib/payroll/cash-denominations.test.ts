import { describe, expect, it } from "vitest";
import { buildCashDenominationSummary } from "./cash-denominations";

describe("buildCashDenominationSummary", () => {
  it("aggregates bills per employee envelope, not just by grand total", () => {
    const summary = buildCashDenominationSummary([
      { employeeId: "a", employeeName: "Amy", roundedPayCents: 15000 },
      { employeeId: "b", employeeName: "Bea", roundedPayCents: 5000 },
    ]);

    expect(summary.totalCents).toBe(20000);
    expect(summary.denominations).toEqual([
      { value: 100, count: 1, totalCents: 10000 },
      { value: 50, count: 2, totalCents: 10000 },
      { value: 20, count: 0, totalCents: 0 },
      { value: 10, count: 0, totalCents: 0 },
      { value: 5, count: 0, totalCents: 0 },
      { value: 1, count: 0, totalCents: 0 },
    ]);
    expect(summary.rows.map((row) => row.bills)).toEqual([
      { 100: 1, 50: 1, 20: 0, 10: 0, 5: 0, 1: 0 },
      { 100: 0, 50: 1, 20: 0, 10: 0, 5: 0, 1: 0 },
    ]);
  });

  it("uses fives before ones to keep the bank pickup list compact", () => {
    const summary = buildCashDenominationSummary([
      { employeeId: "a", employeeName: "Amy", roundedPayCents: 11500 },
    ]);

    expect(summary.denominations).toEqual([
      { value: 100, count: 1, totalCents: 10000 },
      { value: 50, count: 0, totalCents: 0 },
      { value: 20, count: 0, totalCents: 0 },
      { value: 10, count: 1, totalCents: 1000 },
      { value: 5, count: 1, totalCents: 500 },
      { value: 1, count: 0, totalCents: 0 },
    ]);
  });

  it("reports cents remainder separately instead of hiding it in bill counts", () => {
    const summary = buildCashDenominationSummary([
      { employeeId: "a", employeeName: "Amy", roundedPayCents: 10123 },
    ]);

    expect(summary.totalCents).toBe(10123);
    expect(summary.remainderCents).toBe(23);
    expect(summary.rows[0]?.remainderCents).toBe(23);
    expect(summary.denominations[0]).toEqual({
      value: 100,
      count: 1,
      totalCents: 10000,
    });
  });
});
