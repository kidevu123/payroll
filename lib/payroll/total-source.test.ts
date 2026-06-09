import { describe, expect, it } from "vitest";
import { shouldUseStoredPayrollTotals } from "./total-source";

describe("shouldUseStoredPayrollTotals", () => {
  it("treats employee-visible published payslips as authoritative", () => {
    expect(
      shouldUseStoredPayrollTotals({
        periodState: "LOCKED",
        publishedToPortalAt: new Date("2026-06-09T12:00:00.000Z"),
        payslipSumCents: 1_562_000,
        liveRoundedCents: 1_582_000,
      }),
    ).toBe(true);
  });

  it("uses live totals for unlocked unpublished periods", () => {
    expect(
      shouldUseStoredPayrollTotals({
        periodState: "OPEN",
        publishedToPortalAt: null,
        payslipSumCents: 1_562_000,
        liveRoundedCents: 1_582_000,
      }),
    ).toBe(false);
  });
});

