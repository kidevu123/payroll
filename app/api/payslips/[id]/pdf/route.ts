// Serves the PDF for a single Payslip. Authz layered:
//   1. requireSession (login)
//   2. Admin/owner sees any payslip.
//   3. Otherwise: payslip.employee_id must match session.user.employeeId
//      AND the underlying payroll_run must be published_to_portal_at IS
//      NOT NULL — admin pre-publish drafts stay invisible to employees.
// Negative cases land 403 (different employee) or 404 (unpublished /
// non-existent). Tested in the matching .test.ts.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import {
  getPayslip,
  isPayslipPublishedToPortal,
} from "@/lib/db/queries/payslips";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSession();
  const { id } = await context.params;
  const payslip = await getPayslip(id);
  if (!payslip) return new NextResponse("not found", { status: 404 });
  const isAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const isOwner = session.user.employeeId === payslip.employeeId;
  if (!isAdmin && !isOwner) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!isAdmin) {
    const published = await isPayslipPublishedToPortal(id);
    if (!published) return new NextResponse("not found", { status: 404 });
  }
  if (!payslip.pdfPath) {
    return new NextResponse("not generated", { status: 404 });
  }
  const { readFile } = await import(/* webpackIgnore: true */ "fs/promises");
  let bytes: Buffer;
  try {
    bytes = await readFile(payslip.pdfPath);
  } catch {
    return new NextResponse("file missing", { status: 410 });
  }
  // Legacy imports point at .xlsx (the period's bulk admin report) since
  // the original Flask app didn't generate per-employee PDFs. Serve the
  // right Content-Type and force download for non-PDFs.
  const lower = payslip.pdfPath.toLowerCase();
  const isPdf = lower.endsWith(".pdf");
  const ext = lower.endsWith(".xlsx")
    ? "xlsx"
    : lower.endsWith(".xls")
      ? "xls"
      : lower.endsWith(".csv")
        ? "csv"
        : "pdf";
  const contentType = isPdf
    ? "application/pdf"
    : ext === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : ext === "xls"
        ? "application/vnd.ms-excel"
        : ext === "csv"
          ? "text/csv"
          : "application/octet-stream";
  const fileBase = `payslip-${payslip.periodId}`;
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${isPdf ? "inline" : "attachment"}; filename="${fileBase}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
