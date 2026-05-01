// Serves the report file for a single payroll_run. Admin-only. Streams the
// stored PDF (legacy reports) or XLSX from disk. The legacy import script
// copies these into /data/payslips/legacy/<startDate>__<endDate>/report.{pdf|xlsx};
// future cron-generated runs will set pdfPath to a freshly-rendered PDF.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { payrollRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  await requireAdmin();
  const { runId } = await context.params;
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return new NextResponse("not found", { status: 404 });
  if (!run.pdfPath) return new NextResponse("no pdf", { status: 404 });
  const { readFile } = await import(/* webpackIgnore: true */ "fs/promises");
  let bytes: Buffer;
  try {
    bytes = await readFile(run.pdfPath);
  } catch {
    return new NextResponse("file missing", { status: 410 });
  }
  const lower = run.pdfPath.toLowerCase();
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
  const fileBase = `report-${runId.slice(0, 8)}`;
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${isPdf ? "inline" : "attachment"}; filename="${fileBase}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
