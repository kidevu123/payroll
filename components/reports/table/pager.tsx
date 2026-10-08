"use client";

// The ledger footer: "Showing 1-25 of N pay periods" and page numbers.
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { pageNumbers } from "@/lib/reports/table-model";

export function Pager({
  page,
  pageCount,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const btn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-input border px-2 text-xs font-medium tabular-nums transition-colors disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-text-muted sm:px-5">
      <span className="tabular-nums">
        Showing {from}–{to} of {total} pay {total === 1 ? "period" : "periods"}
      </span>
      {pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <button type="button" className={cn(btn, "border-border text-text-muted hover:bg-surface-2")} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          {pageNumbers(page, pageCount).map((n, i) =>
            n === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-text-subtle">…</span>
            ) : (
              <button
                key={n}
                type="button"
                aria-current={n === page ? "page" : undefined}
                onClick={() => onPage(n)}
                className={cn(btn, n === page ? "border-brand-700 bg-brand-50 text-brand-800" : "border-border text-text-muted hover:bg-surface-2")}
              >
                {n}
              </button>
            ),
          )}
          <button type="button" className={cn(btn, "border-border text-text-muted hover:bg-surface-2")} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
