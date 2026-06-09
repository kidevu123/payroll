import { describe, expect, it } from "vitest";
import {
  chooseReportTotals,
  normalizePrintablePersonName,
} from "./build-admin-report";

describe("normalizePrintablePersonName", () => {
  it("normalizes legacy temp prefixes to the matching employee name", () => {
    expect(normalizePrintablePersonName("TEMP_004_Chintu Bolle")).toBe(
      "chintu bolle",
    );
    expect(normalizePrintablePersonName("004_Chintu Bolle")).toBe(
      "chintu bolle",
    );
    expect(normalizePrintablePersonName("Chintu Bolle")).toBe("chintu bolle");
  });

  it("collapses punctuation and whitespace for duplicate detection", () => {
    expect(normalizePrintablePersonName("  Chintu   Bolle  ")).toBe(
      "chintu bolle",
    );
    expect(normalizePrintablePersonName("Chintu-Bolle")).toBe("chintu bolle");
  });
});

describe("chooseReportTotals", () => {
  it("uses stored payslip totals when the report is built from canonical payslips", () => {
    const totals = chooseReportTotals({
      useStoredPayslip: true,
      live: {
        hours: 40,
        regularCents: 48_000,
        overtimeCents: 0,
        taskCents: 0,
        grossCents: 48_000,
        roundedCents: 48_000,
      },
      payslip: {
        hoursWorked: "42.5",
        grossPayCents: 51_000,
        roundedPayCents: 51_000,
        taskPayCents: 0,
      },
    });

    expect(totals).toEqual({
      hours: 42.5,
      regularCents: 51_000,
      overtimeCents: 0,
      taskCents: 0,
      grossCents: 51_000,
      roundedCents: 51_000,
    });
  });

  it("keeps live totals before payslips become canonical", () => {
    const totals = chooseReportTotals({
      useStoredPayslip: false,
      live: {
        hours: 40,
        regularCents: 48_000,
        overtimeCents: 0,
        taskCents: 0,
        grossCents: 48_000,
        roundedCents: 48_000,
      },
      payslip: {
        hoursWorked: "42.5",
        grossPayCents: 51_000,
        roundedPayCents: 51_000,
        taskPayCents: 0,
      },
    });

    expect(totals.roundedCents).toBe(48_000);
    expect(totals.hours).toBe(40);
  });
});
