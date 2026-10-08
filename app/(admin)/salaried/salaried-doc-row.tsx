"use client";

// One uploaded paystub in an employee's list, with its actions.
import * as React from "react";
import { PdfLink } from "@/components/domain/pdf-link";
import { CalendarClock, Download, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ZohoDocStatus } from "@/components/domain/zoho-doc-status";
import { deleteSalariedDocAction } from "./actions";
import { KIND_LABEL, formatRange, type DocLite } from "@/lib/salaried/upload-format";
import { InlineNet } from "./salaried-inline-net";

export function DocRow({ doc }: { doc: DocLite }) {
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const range = formatRange(doc.payPeriodStart, doc.payPeriodEnd);

  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileText className="h-4 w-4 shrink-0 text-text-subtle" />
          <div className="min-w-0">
            {/* The pay-period the stub COVERS is the headline — that's the
                period this paystub is for. The covered range leads in the
                accent so it reads as the row's identity; kind sits beside it,
                and the upload date is demoted to a whispered trailing detail. */}
            <p className="flex items-center gap-1.5">
              {range ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{
                    background: "color-mix(in srgb, var(--dash-cyan) 15%, transparent)",
                    color: "var(--dash-cyan)",
                  }}
                >
                  <CalendarClock className="h-3 w-3" />
                  {range}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-text-subtle">
                  No period set
                </span>
              )}
              <span className="text-micro uppercase text-text-subtle">
                {KIND_LABEL[doc.kind]}
              </span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-subtle">
              <span className="truncate text-text-muted">{doc.originalFilename}</span>
              <span aria-hidden>·</span>
              <span className="whitespace-nowrap">uploaded {doc.uploadedAt.slice(0, 10)}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <InlineNet doc={doc} />
          <ZohoDocStatus doc={doc} />
          <Button asChild size="sm" variant="ghost">
            <PdfLink
              href={`/api/payroll-docs/${doc.id}`}
              filename="paystub.pdf"
              title="View document"
            >
              <Download className="h-3.5 w-3.5" /> View
            </PdfLink>
          </Button>
          <form
            action={async () => {
              if (removing) return;
              setRemoving(true);
              setError(null);
              const r = await deleteSalariedDocAction(doc.id);
              setRemoving(false);
              if (r?.error) setError(r.error);
            }}
          >
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={removing}
              title="Remove document"
            >
              <Trash2 className="h-3.5 w-3.5 text-danger-700" />
            </Button>
          </form>
        </div>
      </div>
      {error && <span className="text-xs text-danger-700">{error}</span>}
    </li>
  );
}
