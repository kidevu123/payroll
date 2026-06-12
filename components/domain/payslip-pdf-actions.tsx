import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

export function payslipPdfHref(
  payslip: { id: string; pdfPath: string | null } | null | undefined,
): string | null {
  if (!payslip?.pdfPath?.toLowerCase().endsWith(".pdf")) return null;
  return `/api/payslips/${payslip.id}/pdf`;
}

export function PayslipPdfActions({
  url,
  printLabel,
  downloadLabel,
  layout = "footer",
  className,
}: {
  url: string;
  printLabel: string;
  downloadLabel: string;
  layout?: "footer" | "inline";
  className?: string;
}) {
  const downloadUrl = `${url}?download=1`;
  const linkClass =
    layout === "inline"
      ? "inline-flex items-center gap-1 rounded-input px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text shrink-0"
      : "inline-flex items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 py-1.5 text-[11px] font-medium tracking-tight text-text-muted transition-colors hover:bg-surface-2 hover:text-text shrink-0";

  const links = (
    <>
      <Link href={url} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <Printer className="h-3.5 w-3.5" aria-hidden />
        {printLabel}
      </Link>
      <Link href={downloadUrl} className={linkClass}>
        <Download className="h-3.5 w-3.5" aria-hidden />
        {downloadLabel}
      </Link>
    </>
  );

  if (layout === "inline") {
    return (
      <div className={cn("inline-flex flex-wrap items-center gap-1", className)}>
        {links}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-surface-2/30 px-4 py-2.5 sm:px-5",
        className,
      )}
    >
      {links}
    </div>
  );
}
