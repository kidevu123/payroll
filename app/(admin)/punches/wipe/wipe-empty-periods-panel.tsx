"use client";

import * as React from "react";
import { CalendarMinus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { wipeEmptyOpenPeriodsAction } from "../wipe-action";

/**
 * Single-button cleanup: hard-delete OPEN pay periods with no punches
 * and no runs attached. Safe by definition — these have no data to
 * lose and were almost certainly auto-created by the period-rollover
 * cron. Now that auto-creation is off, this clears the cruft.
 */
export function WipeEmptyPeriodsPanel() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ deleted: number } | null>(null);

  if (result) {
    return (
      <div className="rounded-card border border-success-200 bg-success-50 p-4 space-y-1">
        <h3 className="font-semibold text-success-700 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Cleaned
        </h3>
        <p className="text-xs text-text-muted">
          Deleted {result.deleted} empty open pay period
          {result.deleted === 1 ? "" : "s"}.
          {result.deleted === 0
            ? " (No empty open periods existed to begin with.)"
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-warn-200 bg-warn-50 p-4 space-y-3">
      <h3 className="font-semibold text-warn-700 flex items-center gap-2">
        <CalendarMinus className="h-4 w-4" /> Wipe empty open pay periods
      </h3>
      <p className="text-xs text-text-muted">
        Hard-deletes every pay period in OPEN state that has zero
        non-voided punches and zero payroll_runs attached. These are
        almost always cron auto-creates that never received any data.
        LOCKED, PAID, or non-empty periods are left alone.
      </p>
      <form
        action={async () => {
          setPending(true);
          setError(null);
          const r = await wipeEmptyOpenPeriodsAction();
          setPending(false);
          if ("error" in r) setError(r.error);
          else setResult({ deleted: r.deleted });
        }}
      >
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          <CalendarMinus className="h-4 w-4" />
          {pending ? "Cleaning…" : "Wipe empty open periods"}
        </Button>
        {error && (
          <p className="mt-2 text-xs text-red-700">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
