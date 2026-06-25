// Shared paystub/payroll-document storage. The web server actions
// (uploadPayrollDocAction, uploadSalariedDocAction) and the MCP tools
// (payroll_upload_period_paystub, payroll_upload_salaried_paystub) all wrote an
// uploaded file the same way — same root, same 10 MB cap, same mime→ext table,
// same random-name + 0o640 write — in four hand-maintained copies that could
// drift. They now share this module. Path layout, size/type validation, and the
// createDoc() insert stay with each caller (those genuinely differ).

export const PAYROLL_DOC_ROOT =
  process.env.PAYROLL_DOC_ROOT ?? "/data/uploads/payroll-docs";

export const PAYROLL_DOC_MAX_BYTES = 10 * 1024 * 1024;

export function mimeToExt(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return ".xlsx";
    default:
      return "";
  }
}

/**
 * Write an uploaded document under PAYROLL_DOC_ROOT/<...segments> with a random
 * filename (preserving extension) and 0o640 perms. Returns the absolute path.
 * Dynamic node imports keep this safe to import from Next.js server actions.
 */
export async function writePaystubFile(opts: {
  /** Path under PAYROLL_DOC_ROOT, e.g. [periodId, employeeId] or ["_salaried", employeeId]. */
  segments: string[];
  originalFilename: string;
  mime: string;
  buf: Buffer | Uint8Array;
}): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join, extname } = await import("node:path");
  const { randomUUID } = await import("node:crypto");
  const dir = join(PAYROLL_DOC_ROOT, ...opts.segments);
  await mkdir(dir, { recursive: true });
  const ext = extname(opts.originalFilename) || mimeToExt(opts.mime);
  const filePath = join(dir, `${randomUUID()}${ext}`);
  await writeFile(filePath, opts.buf, { mode: 0o640 });
  return filePath;
}
