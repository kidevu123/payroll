"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reinstateEmployeeAction } from "../actions";

/**
 * Shown on a terminated employee's page: the way back when they return.
 * Two taps (open, confirm) so a stray click cannot put someone back on
 * payroll.
 */
export function ReinstateEmployeeButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await reinstateEmployeeAction(id);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <section
      aria-labelledby="reinstate-heading"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning-200 bg-warning-50 p-4"
    >
      <div className="min-w-0">
        <h2 id="reinstate-heading" className="text-sm font-medium text-text">
          {name} is terminated
        </h2>
        <p aria-live="polite" className="mt-0.5 text-xs text-text-muted">
          {open
            ? "Reinstating puts them back on Time and Payroll and turns their login back on. Past payslips and rate history stay as they are."
            : "Back at work? Reinstate them to put them on Time and Payroll again."}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-danger-700">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {open ? (
          <>
            {/* autoFocus: opening the confirm step unmounts the button that
                had focus, so hand focus to its replacement. */}
            <Button type="button" size="sm" onClick={confirm} disabled={pending} autoFocus>
              <RotateCcw className="h-4 w-4" />
              {pending ? "Reinstating…" : "Confirm reinstate"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <RotateCcw className="h-4 w-4" /> Reinstate employee
          </Button>
        )}
      </div>
    </section>
  );
}
