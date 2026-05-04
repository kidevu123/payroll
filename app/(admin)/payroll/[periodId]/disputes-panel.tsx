"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveDisputeAction } from "./actions";

export type DisputeRow = {
  payslipId: string;
  employeeName: string;
  reason: string;
  disputedAt: string;
};

/**
 * Sticky-style banner listing every open employee-reported problem on
 * this period's payslips. One-tap "Mark resolved" per row writes
 * disputeResolvedAt + audit. Reason text is shown in full so admin
 * doesn't have to drill in.
 */
export function DisputesPanel({ disputes }: { disputes: DisputeRow[] }) {
  const [open, setOpen] = React.useState<DisputeRow[]>(disputes);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (open.length === 0) return null;

  return (
    <div className="rounded-card border border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-center gap-2 font-medium text-amber-900">
        <AlertTriangle className="h-4 w-4" />
        <span>
          {open.length} payslip{open.length === 1 ? "" : "s"} reported as a
          problem
        </span>
      </div>
      <ul className="space-y-2">
        {open.map((d) => (
          <li
            key={d.payslipId}
            className="rounded-input border border-amber-200 bg-surface p-2.5 text-xs space-y-1"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-text">{d.employeeName}</p>
                <p className="text-text-muted">
                  Reported {new Date(d.disputedAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending === d.payslipId}
                onClick={async () => {
                  setPending(d.payslipId);
                  setError(null);
                  const r = await resolveDisputeAction(d.payslipId);
                  setPending(null);
                  if (r?.error) {
                    setError(r.error);
                    return;
                  }
                  setOpen((prev) =>
                    prev.filter((x) => x.payslipId !== d.payslipId),
                  );
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-text-muted">{d.reason}</p>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
