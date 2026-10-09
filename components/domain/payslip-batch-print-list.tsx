"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PdfLink } from "@/components/domain/pdf-link";
import { ChevronDown, ChevronUp, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MicroLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import {
  PayslipPdfActions,
  payslipPdfHref,
} from "@/components/domain/payslip-pdf-actions";
import {
  STATUS_CHIP_BASE,
  statusChipClasses,
} from "@/components/domain/status-pill";

export type PayslipBatchItem = {
  id: string;
  periodLabel: string;
  hoursLabel: string;
  payLabel: string;
  /** No hours and no pay: rendered quieter so paid weeks stand out. */
  isEmpty: boolean;
  acknowledged: boolean;
  /** An open dispute the office still has to resolve. */
  disputed: boolean;
  pdfPath: string | null;
};

/** Rows shown before "Show all": about two months of weekly payslips. */
const INITIAL_VISIBLE = 8;

// Every row is its own grid container, so each track is a fixed size or the
// one flexible column. An `auto` track would resolve per row and the Hours
// and Pay columns would stop lining up.
//
// The columns appear at a CONTAINER width (@xl = 36rem), not a viewport
// width: this list sits beside a rail and a sidebar, so at a 1024px viewport
// the card is ~360px wide and viewport breakpoints would squeeze six columns
// into it. Narrower than that, the figures move under the period.
const ROW_GRID =
  "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 @xl:grid-cols-[1.25rem_minmax(0,1fr)_5rem_6.5rem_7rem_7.5rem]";
const WIDE_ONLY = "hidden @xl:block";

function batchPdfUrl(
  employeeId: string,
  ids: string[],
  opts: { download?: boolean },
): string {
  const params = new URLSearchParams({
    ids: ids.join(","),
    layout: "compact",
  });
  if (opts.download) params.set("download", "1");
  return `/api/employees/${employeeId}/payslips/batch-pdf?${params}`;
}

function StatusChip({ item }: { item: PayslipBatchItem }) {
  if (item.disputed) {
    return (
      <span className={cn(STATUS_CHIP_BASE, statusChipClasses("warn"))}>
        Disputed
      </span>
    );
  }
  if (item.acknowledged) {
    return (
      <span className={cn(STATUS_CHIP_BASE, statusChipClasses("success"))}>
        Acknowledged
      </span>
    );
  }
  return null;
}

export function PayslipBatchPrintList({
  employeeId,
  items,
}: {
  employeeId: string;
  items: PayslipBatchItem[];
}) {
  const allIds = useMemo(() => items.map((i) => i.id), [items]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const count = selected.size;
  const allSelected = items.length > 0 && count === items.length;

  // "Some but not all" has no HTML attribute; it can only be set in script.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = count > 0 && !allSelected;
    }
  }, [count, allSelected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = allIds.filter((id) => selected.has(id));
  const hiddenCount = Math.max(0, items.length - INITIAL_VISIBLE);
  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE);

  return (
    <div className="@container">
      {/* Column header doubles as the selection bar. */}
      <div
        className={cn(
          ROW_GRID,
          "min-h-11 border-b border-border/60 px-4 py-2 @xl:px-6",
        )}
      >
        <input
          ref={selectAllRef}
          type="checkbox"
          className="h-4 w-4 rounded border-border accent-brand-700"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
          aria-label={`Select all ${items.length} payslips`}
        />
        {count > 0 ? (
          <div className="col-span-2 flex flex-wrap items-center gap-2 @xl:col-span-5">
            <span className="text-sm font-medium text-text">
              {count} selected
            </span>
            <Button asChild size="sm" variant="secondary" className="h-8 text-xs">
              <PdfLink
                href={batchPdfUrl(employeeId, selectedIds, {})}
                filename="payslips.pdf"
              >
                <Printer className="h-3.5 w-3.5" />
                Print
              </PdfLink>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <PdfLink
                href={batchPdfUrl(employeeId, selectedIds, { download: true })}
                filename="payslips.pdf"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </PdfLink>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        ) : (
          <>
            <MicroLabel className="col-span-2 @xl:col-span-1">Pay period</MicroLabel>
            <MicroLabel className={cn(WIDE_ONLY, "text-right")}>Hours</MicroLabel>
            <MicroLabel className={cn(WIDE_ONLY, "text-right")}>Pay</MicroLabel>
            <MicroLabel className={WIDE_ONLY}>Status</MicroLabel>
            <span className={WIDE_ONLY} />
          </>
        )}
      </div>

      <ul className="divide-y divide-border/60">
        {visible.map((item) => {
          const pdfUrl = payslipPdfHref({ id: item.id, pdfPath: item.pdfPath });
          const checked = selected.has(item.id);
          return (
            <li
              key={item.id}
              className={cn(
                ROW_GRID,
                "px-4 py-2.5 text-sm transition-colors hover:bg-surface-2/40 @xl:px-6",
                checked && "bg-brand-50/50 hover:bg-brand-50/50",
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-brand-700"
                checked={checked}
                onChange={() => toggle(item.id)}
                aria-label={`Select payslip ${item.periodLabel}`}
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-medium @xl:truncate",
                    item.isEmpty ? "text-text-muted" : "text-text",
                  )}
                >
                  {item.periodLabel}
                </p>
                {/* Narrow card: the figures move under the period. */}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tabular-nums text-text-muted @xl:hidden">
                  {item.isEmpty ? (
                    <span>No hours</span>
                  ) : (
                    <>
                      <span>{item.hoursLabel}</span>
                      <span aria-hidden>·</span>
                      <span className="font-medium text-text">{item.payLabel}</span>
                    </>
                  )}
                  <StatusChip item={item} />
                </p>
              </div>
              <span
                className={cn(
                  WIDE_ONLY,
                  "text-right tabular-nums",
                  item.isEmpty ? "text-text-subtle" : "text-text-muted",
                )}
              >
                {item.hoursLabel}
              </span>
              <span
                className={cn(
                  WIDE_ONLY,
                  "text-right tabular-nums",
                  item.isEmpty ? "text-text-subtle" : "font-medium text-text",
                )}
              >
                {item.payLabel}
              </span>
              <span className={WIDE_ONLY}>
                <StatusChip item={item} />
              </span>
              <div className="flex justify-end">
                {pdfUrl ? (
                  <PayslipPdfActions
                    url={pdfUrl}
                    printLabel="Print"
                    downloadLabel="PDF"
                    layout="inline"
                    className="flex-nowrap"
                  />
                ) : item.pdfPath ? (
                  <Button asChild size="sm" variant="ghost">
                    <PdfLink href={`/api/payslips/${item.id}/pdf`} filename="payslip.pdf">
                      <Download className="h-3.5 w-3.5" /> File
                    </PdfLink>
                  </Button>
                ) : (
                  <span className="text-xs text-text-subtle">No PDF</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <div className="border-t border-border/60 px-4 py-2 @xl:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 h-9 text-xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Show recent only
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> Show all {items.length} payslips
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
