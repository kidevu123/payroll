"use client";

import * as React from "react";
import { AlertTriangle, CircleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportPayslipProblemAction } from "./actions";

/**
 * Inline expandable problem-report form. Hidden until the employee taps
 * "Report a problem"; expands to a textarea + submit. Submitting writes
 * a dispute on the payslip and notifies admins.
 */
export function ReportProblemButton({
  payslipId,
  alreadyDisputed,
}: {
  payslipId: string;
  alreadyDisputed: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  if (done || alreadyDisputed) {
    return (
      <div className="flex items-center gap-2 rounded-input border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <CircleAlert className="h-3.5 w-3.5" />
        <span>
          Problem reported. Admin has been notified and will follow up.
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-amber-700 hover:text-amber-900 hover:bg-amber-50"
      >
        <AlertTriangle className="h-4 w-4" /> Report a problem
      </Button>
    );
  }

  return (
    <div className="rounded-card border border-amber-300 bg-amber-50/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-amber-900">
          What&apos;s wrong with this payslip?
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <textarea
        className="w-full h-24 rounded-input border border-border bg-surface px-3 py-2 text-sm"
        placeholder="e.g. I was paid for 40 hours but I worked 48. The hours from Tuesday and Wednesday are missing."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
        maxLength={1000}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted">
          {reason.length}/1000
        </span>
        {error && <span className="text-xs text-red-700">{error}</span>}
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={pending || reason.trim().length < 5}
          onClick={async () => {
            setPending(true);
            setError(null);
            const r = await reportPayslipProblemAction(payslipId, reason);
            setPending(false);
            if (r?.error) {
              setError(r.error);
              return;
            }
            setDone(true);
          }}
        >
          {pending ? "Sending…" : "Send report"}
        </Button>
      </div>
    </div>
  );
}
