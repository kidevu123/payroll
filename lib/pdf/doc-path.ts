// Where the pre-compiled PDF documents live at runtime. The Dockerfile
// esbuilds lib/pdf/*.tsx to /app/.next/pdf/*.js (see the comment there
// for why they cannot ride the webpack bundle). PDF_DOCS_DIR overrides
// the directory so a local dev server or a script can point at its own
// esbuild output instead of the container path.

import { join } from "node:path";

export function pdfDocPath(
  name:
    | "admin-report"
    | "payslip-cut-sheet"
    | "payslip-batch-sheet"
    | "payslip"
    | "signature-report"
    | "employee-guide",
): string {
  return join(process.env.PDF_DOCS_DIR ?? "/app/.next/pdf", `${name}.js`);
}
