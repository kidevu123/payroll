import { renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AdminReport } from "./admin-report";
import { PayslipCutSheet } from "./payslip-cut-sheet";
import type { AdminReportInput } from "./types";

const sampleEmployee = (idx: number): AdminReportInput["employees"][number] => ({
  displayName: `Employee ${idx}`,
  legalName: `Employee ${idx}`,
  legacyId: String(idx),
  shiftName: "Day",
  hourlyRateCents: 1200,
  days: [
    {
      date: "2026-05-18",
      inTime: "06:05:00",
      outTime: "18:10:00",
      hours: 12.08,
      cents: 14496,
      isOvertime: false,
    },
    {
      date: "2026-05-19",
      missing: true,
      hours: 0,
      cents: 0,
      isOvertime: false,
    },
  ],
  totals: {
    hours: 12.08,
    regularCents: 14496,
    overtimeCents: 0,
    taskCents: 0,
    grossCents: 14496,
    roundedCents: 14500,
  },
  taskPay: [],
});

const sample: AdminReportInput = {
  company: {
    name: "Milo",
    address: "123 Main St",
    brandColorHex: "#067049",
    locale: "en-US",
  },
  period: { startDate: "2026-05-18", endDate: "2026-05-24" },
  rules: { rounding: "NEAREST_DOLLAR", hoursDecimalPlaces: 2 },
  employees: Array.from({ length: 12 }, (_, i) => sampleEmployee(i + 1)),
  generatedAt: "2026-05-27T00:34:26.728Z",
};

describe("admin report PDFs", () => {
  it("renders the compact admin report", async () => {
    const buf = await renderToBuffer(<AdminReport data={sample} />);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  }, 30_000);

  it("renders a tablet signature on the sign line when present", async () => {
    // Opaque black stroke on a transparent pad, like the kiosk produces.
    const stroke = await sharp({
      create: { width: 300, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const pad = await sharp({
      create: { width: 600, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: stroke, left: 60, top: 110 }])
      .png()
      .toBuffer();
    const signed: AdminReportInput = {
      ...sample,
      employees: [
        {
          ...sampleEmployee(1),
          signaturePng: `data:image/png;base64,${pad.toString("base64")}`,
          signedAt: "9/8/26",
        },
        sampleEmployee(2),
      ],
    };
    const countImages = (b: Buffer) =>
      (b.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;
    const plain = await renderToBuffer(<AdminReport data={sample} />);
    expect(countImages(plain)).toBe(0);
    const buf = await renderToBuffer(<AdminReport data={signed} />);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    // The transparent PNG lands as an image + its alpha soft mask; what
    // matters is that an unsigned report has none and a signed one does.
    expect(countImages(buf)).toBeGreaterThan(0);
  }, 30_000);

  it("renders the compact payslip cut sheet", async () => {
    const buf = await renderToBuffer(<PayslipCutSheet data={sample} />);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  }, 30_000);
});
