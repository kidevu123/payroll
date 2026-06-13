import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { getPayslip } from "@/lib/db/queries/payslips";
import {
  mergePayslipPdfs1Up,
  mergePayslipPdfs2Up,
} from "@/lib/pdf/merge-payslips-2up";

const idSchema = z.string().uuid();

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  await requireAdmin();
  const { id: employeeId } = await ctx.params;
  if (!idSchema.safeParse(employeeId).success) {
    return new NextResponse("invalid employee", { status: 400 });
  }
  const employee = await getEmployee(employeeId);
  if (!employee) return new NextResponse("not found", { status: 404 });

  const url = new URL(req.url);
  const rawIds = url.searchParams.get("ids") ?? "";
  const ids = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return new NextResponse("ids required", { status: 400 });
  }
  if (ids.length > 52) {
    return new NextResponse("too many payslips (max 52)", { status: 400 });
  }
  for (const payslipId of ids) {
    if (!idSchema.safeParse(payslipId).success) {
      return new NextResponse("invalid payslip id", { status: 400 });
    }
  }

  const layout = url.searchParams.get("layout") === "1" ? "1" : "2";
  const forceDownload =
    url.searchParams.get("download") === "1" ||
    url.searchParams.get("download") === "true";

  const buffers: Buffer[] = [];
  for (const payslipId of ids) {
    const payslip = await getPayslip(payslipId);
    if (!payslip || payslip.employeeId !== employeeId) {
      return new NextResponse(`payslip not found: ${payslipId}`, { status: 404 });
    }
    if (!payslip.pdfPath?.toLowerCase().endsWith(".pdf")) {
      return new NextResponse(
        `payslip ${payslipId} has no printable PDF — pick periods with PDF generated`,
        { status: 422 },
      );
    }
    try {
      buffers.push(await readFile(payslip.pdfPath));
    } catch {
      return new NextResponse(`payslip file missing: ${payslipId}`, { status: 410 });
    }
  }

  let pdfBytes: Buffer;
  try {
    pdfBytes =
      layout === "1"
        ? await mergePayslipPdfs1Up(buffers)
        : await mergePayslipPdfs2Up(buffers);
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "merge failed",
      { status: 500 },
    );
  }

  const slug = employee.displayName.replace(/[^\w.-]+/g, "_").slice(0, 40);
  const filename = `payslips_${slug}_${ids.length}.pdf`;
  const disposition = forceDownload ? "attachment" : "inline";

  return new NextResponse(pdfBytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
