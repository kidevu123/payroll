// Serves a single payroll_period_document. Authz:
//   - admin/owner: any non-deleted doc
//   - employee: only their own doc with visibleToEmployee = true and
//     deletedAt IS NULL.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { getDoc } from "@/lib/db/queries/payroll-documents";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSession();
  const { id } = await context.params;
  const doc = await getDoc(id);
  if (!doc) return new NextResponse("not found", { status: 404 });
  if (doc.deletedAt) return new NextResponse("not found", { status: 404 });
  const isAdmin =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const isOwner = session.user.employeeId === doc.employeeId;
  if (!isAdmin) {
    if (!isOwner || !doc.visibleToEmployee) {
      return new NextResponse("forbidden", { status: 403 });
    }
  }
  const { readFile } = await import(/* webpackIgnore: true */ "fs/promises");
  let bytes: Buffer;
  try {
    bytes = await readFile(doc.filePath);
  } catch {
    return new NextResponse("file missing", { status: 410 });
  }
  const headers = new Headers({
    "Content-Type": doc.mime,
    "Content-Length": String(bytes.byteLength),
    // Inline for PDFs/images so the browser shows them; attachment for
    // other types so the user gets a save dialog.
    "Content-Disposition":
      doc.mime === "application/pdf" || doc.mime.startsWith("image/")
        ? `inline; filename="${encodeFilename(doc.originalFilename)}"`
        : `attachment; filename="${encodeFilename(doc.originalFilename)}"`,
    "Cache-Control": "private, no-cache",
  });
  // NextResponse expects a BodyInit; Buffer satisfies it but TS lib types
  // pick the URLSearchParams overload first. Cast through Uint8Array.
  return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
}

function encodeFilename(name: string): string {
  // Fall back to ascii-safe — RFC 6266 with UTF-8 is overkill for this
  // surface; admin uploads are typically already plain.
  return name.replace(/[^\w.\- ]/g, "_");
}
