"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PayslipPdfActions,
  payslipPdfHref,
} from "@/components/domain/payslip-pdf-actions";

export type PayslipBatchItem = {
  id: string;
  periodLabel: string;
  hoursLabel: string;
  payLabel: string;
  acknowledged: boolean;
  pdfPath: string | null;
};

function batchPdfUrl(
  employeeId: string,
  ids: string[],
  opts: { download?: boolean; layout?: "1" | "2" },
): string {
  const params = new URLSearchParams({ ids: ids.join(",") });
  if (opts.download) params.set("download", "1");
  if (opts.layout === "1") params.set("layout", "1");
  return `/api/employees/${employeeId}/payslips/batch-pdf?${params}`;
}

export function PayslipBatchPrintList({
  employeeId,
  items,
}: {
  employeeId: string;
  items: PayslipBatchItem[];
}) {
  const printableIds = useMemo(
    () =>
      new Set(
        items
          .filter((i) => payslipPdfHref({ id: i.id, pdfPath: i.pdfPath }))
          .map((i) => i.id),
      ),
    [items],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPrintable = () => {
    setSelected(new Set(printableIds));
  };

  const clearSelection = () => setSelected(new Set());

  const selectedPrintable = [...selected].filter((id) => printableIds.has(id));
  const count = selectedPrintable.length;
  const batchUrl =
    count > 0 ? batchPdfUrl(employeeId, selectedPrintable, { layout: "2" }) : null;
  const batchDownloadUrl =
    count > 0
      ? batchPdfUrl(employeeId, selectedPrintable, { download: true, layout: "2" })
      : null;

  return (
    <div className="space-y-3">
      {printableIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 pb-1 border-b border-border/60">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={selectAllPrintable}
          >
            Select all ({printableIds.size})
          </Button>
          {selected.size > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={clearSelection}
            >
              Clear
            </Button>
          )}
          {batchUrl && (
            <>
              <Button asChild size="sm" variant="secondary" className="h-8 text-xs">
                <Link href={batchUrl} target="_blank" rel="noopener noreferrer">
                  <Printer className="h-3.5 w-3.5" />
                  Print {count} selected (2 per page)
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link href={batchDownloadUrl!}>
                  <Download className="h-3.5 w-3.5" />
                  Download {count}
                </Link>
              </Button>
            </>
          )}
        </div>
      )}

      <ul className="divide-y divide-border/60">
        {items.map((item) => {
          const pdfUrl = payslipPdfHref({ id: item.id, pdfPath: item.pdfPath });
          const canSelect = Boolean(pdfUrl);
          const checked = selected.has(item.id);
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center justify-between gap-2 py-2 text-sm",
                checked && "bg-brand-50/40 -mx-2 px-2 rounded-input",
              )}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {canSelect ? (
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-brand-700"
                    checked={checked}
                    onChange={() => toggle(item.id)}
                    aria-label={`Select payslip ${item.periodLabel}`}
                  />
                ) : (
                  <span className="mt-1 w-4 shrink-0" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="font-medium truncate">{item.periodLabel}</p>
                  <p className="text-xs text-text-muted">
                    {item.hoursLabel}
                    {" · "}
                    {item.payLabel}
                    {item.acknowledged && " · acknowledged"}
                  </p>
                </div>
              </div>
              {pdfUrl ? (
                <PayslipPdfActions
                  url={pdfUrl}
                  printLabel="Print"
                  downloadLabel="PDF"
                  layout="inline"
                />
              ) : item.pdfPath ? (
                <Button asChild size="sm" variant="ghost">
                  <Link
                    href={`/api/payslips/${item.id}/pdf`}
                    target="_blank"
                    rel="noopener"
                  >
                    <Download className="h-3.5 w-3.5" /> File
                  </Link>
                </Button>
              ) : (
                <span className="text-xs text-text-subtle">No PDF</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
