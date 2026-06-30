import { describe, expect, it } from "vitest";
import { computeReportsOverview } from "./reports-overview";
import { periodNetCents } from "./period-net";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";

function mkRow(over: Partial<ReportRow>): ReportRow {
  return {
    id: "run-1",
    periodId: "p1",
    startDate: "2026-03-15",
    endDate: "2026-03-21",
    source: "NGTECO" as ReportRow["source"],
    state: "PUBLISHED" as ReportRow["state"],
    scheduleName: "Salaried",
    amountCents: 0,
    grossPayCents: 0,
    docNetPayCents: 0,
    replacedRunNetCents: 0,
    tempLaborCents: 0,
    createdByDisplay: "system",
    postedAt: new Date("2026-03-22T00:00:00Z"),
    publishedToPortalAt: null,
    pdfPath: null,
    zohoPushes: [],
    periodState: "PAID",
    periodPaymentMethod: "BANK",
    ...over,
  };
}

describe("periodNetCents", () => {
  it("swaps the untaxed run net for the real paystub net", () => {
    // run computed $2000 untaxed; paystub net is $1400 → period net $1400.
    expect(
      periodNetCents({
        runTotalCents: 200000,
        replacedRunNetCents: 200000,
        docNetPayCents: 140000,
        tempLaborCents: 0,
      }),
    ).toBe(140000);
  });
});

describe("computeReportsOverview applies the salaried/W2 net swap", () => {
  it("YTD-paid + net trend use real take-home, not the pre-tax run amount", () => {
    // A PAID salaried period: run amount $2000, but the paystub take-home is
    // $1400. The overview must report $1400, not $2000 (the old bug).
    const reports = [
      mkRow({
        amountCents: 200000,
        replacedRunNetCents: 200000,
        docNetPayCents: 140000,
      }),
    ];
    const ov = computeReportsOverview(reports, [], 2026);
    expect(ov.kpis.totalPaidYtdCents).toBe(140000);
    // March is index 2.
    expect(ov.netTrend[2]?.cents).toBe(140000);
  });

  it("per-period values are counted once even with multiple runs in a period", () => {
    // Two runs in the same period: amounts $1200 + $800 = $2000 run total; the
    // period-level swap/temp values appear on every row but must count once.
    const reports = [
      mkRow({
        id: "r1",
        amountCents: 120000,
        replacedRunNetCents: 200000,
        docNetPayCents: 140000,
        tempLaborCents: 5000,
      }),
      mkRow({
        id: "r2",
        amountCents: 80000,
        replacedRunNetCents: 200000,
        docNetPayCents: 140000,
        tempLaborCents: 5000,
      }),
    ];
    const ov = computeReportsOverview(reports, [], 2026);
    // 2000 - 2000 + 1400 + 50 (temp once) = 1450.
    expect(ov.kpis.totalPaidYtdCents).toBe(145000);
  });
});
