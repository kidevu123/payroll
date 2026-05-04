// Streams a printable admin report PDF — per-employee day breakdown
// (with signature + date lines), followed by a single payroll summary
// table. Owner directive: matches the legacy "Admin Report" format
// they use for handing the printed sheet to employees to sign.
//
// Builds on demand via the shared lib/pdf/build-admin-report.ts so the
// PDF the accountant signs and the summary table the Zoho push uploads
// stay byte-identical for the same period.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { buildAdminReportArtifacts } from "@/lib/pdf/build-admin-report";

export async function GET(
  _req: Request,
  context: { params: Promise<{ periodId: string }> },
): Promise<Response> {
  await requireAdmin();
  const { periodId } = await context.params;
  const period = await getPeriodById(periodId);
  if (!period) return new NextResponse("period not found", { status: 404 });

  const { pdfBytes, filename } = await buildAdminReportArtifacts(periodId);
  return new NextResponse(pdfBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
