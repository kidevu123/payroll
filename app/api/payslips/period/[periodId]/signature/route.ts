// Streams the period signature report PDF. Admin-only.

import { NextResponse } from "next/server";
import { join } from "path";
import { requireAdmin } from "@/lib/auth-guards";
import { getPeriodById } from "@/lib/db/queries/pay-periods";

const PAYSLIP_ROOT = process.env.PAYSLIP_STORAGE_DIR ?? "/data/payslips";

export async function GET(
  _req: Request,
  context: { params: Promise<{ periodId: string }> },
): Promise<Response> {
  await requireAdmin();
  const { periodId } = await context.params;
  const period = await getPeriodById(periodId);
  if (!period) return new NextResponse("period not found", { status: 404 });
  const path = join(PAYSLIP_ROOT, period.startDate, "signature-report.pdf");
  const { readFile } = await import("fs/promises");
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return new NextResponse("not yet generated", { status: 404 });
  }
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="signature-report-${period.startDate}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
