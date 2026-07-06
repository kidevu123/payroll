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

  it("falls back to live totals when a PAID period has no payslips (no run ever generated)", () => {
    expect(
      shouldUseStoredPayrollTotals({
        periodState: "PAID",
        publishedToPortalAt: null,
        payslipSumCents: 0,
        liveRoundedCents: 132_400,
      }),
    ).toBe(false);
  });

  it("still freezes PAID periods that do have stored payslips", () => {
    expect(
      shouldUseStoredPayrollTotals({
        periodState: "PAID",
        publishedToPortalAt: null,
        payslipSumCents: 132_400,
        liveRoundedCents: 132_450,
      }),
    ).toBe(true);
  });

  it("keeps stored totals for legacy imports with sparse punch data", () => {
    expect(
      shouldUseStoredPayrollTotals({
        periodState: "LOCKED",
        runSource: "LEGACY_IMPORT",
        publishedToPortalAt: null,
        payslipSumCents: 1_562_000,
        liveRoundedCents: 0,
      }),
    ).toBe(true);
  });
});

