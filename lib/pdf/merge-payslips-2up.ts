import { PDFDocument } from "pdf-lib";

const LETTER_W = 612;
const LETTER_H = 792;
const MARGIN = 36;
const GAP = 10;

/** Merge single-page payslip PDFs into one document, two payslips per sheet. */
export async function mergePayslipPdfs2Up(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error("mergePayslipPdfs2Up: no PDFs to merge");
  }
  const slotW = LETTER_W - MARGIN * 2;
  const slotH = (LETTER_H - MARGIN * 2 - GAP) / 2;
  const out = await PDFDocument.create();

  for (let i = 0; i < buffers.length; i += 2) {
    const sheet = out.addPage([LETTER_W, LETTER_H]);
    for (let slot = 0; slot < 2; slot++) {
      const idx = i + slot;
      if (idx >= buffers.length) break;
      const bytes = buffers[idx];
      if (!bytes) break;
      const donor = await PDFDocument.load(bytes, { ignoreEncryption: true });
      if (donor.getPageCount() === 0) continue;
      const embeddedPages = await out.embedPdf(donor, [0]);
      const embedded = embeddedPages[0];
      if (!embedded) continue;
      const y =
        slot === 0
          ? LETTER_H - MARGIN - slotH
          : MARGIN;
      sheet.drawPage(embedded, {
        x: MARGIN,
        y,
        width: slotW,
        height: slotH,
      });
    }
  }

  return Buffer.from(await out.save());
}

/** One payslip per page — still a single print job / download. */
export async function mergePayslipPdfs1Up(buffers: Buffer[]): Promise<Buffer> {
  if (buffers.length === 0) {
    throw new Error("mergePayslipPdfs1Up: no PDFs to merge");
  }
  const out = await PDFDocument.create();
  for (const bytes of buffers) {
    const donor = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(
      donor,
      Array.from({ length: donor.getPageCount() }, (_, i) => i),
    );
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save());
}
