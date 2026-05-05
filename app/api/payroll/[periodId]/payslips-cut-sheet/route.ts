// Cuttable employee payslips PDF for a period. Two-column grid of
// cards with the daily In/Out/Hours/Pay table + total + rounded — no
// signature, no shift label. Owner cuts along the dashed lines and
// hands each employee their own slip.
//
// Uses the same period-level data as the admin report (via
// buildAdminReportArtifacts) so totals never disagree with the
// signed admin copy.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { buildPayslipCutSheet } from "@/lib/pdf/build-admin-report";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ periodId: string }> },
): Promise<Response> {
  await requireAdmin();
  const { periodId } = await ctx.params;
  let pdfBytes: Buffer;
  let filename: string;
  try {
    const r = await buildPayslipCutSheet(periodId);
    pdfBytes = r.pdfBytes;
    filename = r.filename;
  } catch (err) {
    return new NextResponse(err instanceof Error ? err.message : "render failed", {
      status: 500,
    });
  }
  return new NextResponse(pdfBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
