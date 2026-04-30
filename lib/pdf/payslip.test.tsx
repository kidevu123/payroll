// Smoke test for the payslip PDF: render to a buffer and verify it
// produced bytes plus that the input shape compiles. This is not a
// pixel-diff snapshot — string-content checks via @react-pdf/renderer's
// renderToBuffer keep the test stable across font + engine versions.

import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PayslipDoc } from "./payslip";
import type { PayslipDocInput } from "./types";

const sample: PayslipDocInput = {
  company: {
    name: "Acme Manufacturing",
    address: "123 Main St, Anytown",
    brandColorHex: "#0f766e",
    locale: "en-US",
  },
  employee: {
    displayName: "Aaliyah Hernandez",
    legalName: "Aaliyah Hernandez",
    legacyId: "LEGACY-101",
    shiftName: "Day",
  },
  period: { startDate: "2026-04-13", endDate: "2026-04-19" },
  rules: { rounding: "NEAREST_DOLLAR", hoursDecimalPlaces: 2 },
  days: [
    { date: "2026-04-13", hours: 8, cents: 16000, isOvertime: false },
    { date: "2026-04-14", hours: 8, cents: 16000, isOvertime: false },
    { date: "2026-04-17", hours: 10, cents: 20000, isOvertime: true },
  ],
  totals: {
    hours: 26,
    regularCents: 52000,
    overtimeCents: 1000,
    taskCents: 5000,
    grossCents: 58000,
    roundedCents: 58000,
  },
  taskPay: [{ description: "Bonus", amountCents: 5000 }],
  generatedAt: "2026-04-19T19:30:00Z",
};

describe("PayslipDoc", () => {
  it("renders to a non-empty PDF buffer", async () => {
    const buf = await renderToBuffer(<PayslipDoc data={sample} />);
    expect(buf.length).toBeGreaterThan(1000);
    // PDF magic bytes: %PDF-
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  }, 30_000);
});
