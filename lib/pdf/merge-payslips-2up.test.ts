import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { mergePayslipPdfs1Up, mergePayslipPdfs2Up } from "./merge-payslips-2up";

async function blankPayslipPdf(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText(label, { x: 72, y: 720, size: 14 });
  return Buffer.from(await doc.save());
}

describe("mergePayslipPdfs2Up", () => {
  it("packs two single-page PDFs onto one sheet", async () => {
    const merged = await mergePayslipPdfs2Up([
      await blankPayslipPdf("A"),
      await blankPayslipPdf("B"),
    ]);
    const out = await PDFDocument.load(merged);
    expect(out.getPageCount()).toBe(1);
  });

  it("uses two sheets for three payslips", async () => {
    const merged = await mergePayslipPdfs2Up([
      await blankPayslipPdf("A"),
      await blankPayslipPdf("B"),
      await blankPayslipPdf("C"),
    ]);
    const out = await PDFDocument.load(merged);
    expect(out.getPageCount()).toBe(2);
  });
});

describe("mergePayslipPdfs1Up", () => {
  it("concatenates one page per payslip", async () => {
    const merged = await mergePayslipPdfs1Up([
      await blankPayslipPdf("A"),
      await blankPayslipPdf("B"),
    ]);
    const out = await PDFDocument.load(merged);
    expect(out.getPageCount()).toBe(2);
  });
});
