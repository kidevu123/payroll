"use client";

import * as React from "react";
import {
  CircleCheck,
  CircleX,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";
import {
  approveRunAction,
  advanceToReviewAction,
  cancelRunAction,
  retryIngestAction,
} from "./actions";

export function RunActions({
  runId,
  state,
  unresolvedAlerts,
  totals,
}: {
  runId: string;
  state: string;
  unresolvedAlerts: number;
  totals: { employees: number; gross: number; rounded: number };
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (state === "PUBLISHED") {
    return (
      <div className="rounded-card border-2 border-emerald-200 bg-emerald-50/40 p-4 flex items-center gap-3">
        <CircleCheck className="h-5 w-5 text-emerald-700" />
        <span className="text-sm text-emerald-800">
          Run published. Payslips delivered.
        </span>
      </div>
    );
  }

  if (state === "AWAITING_ADMIN_REVIEW") {
    return (
      <div className="space-y-3 rounded-card border-2 border-brand-700 bg-surface p-5">
        {!confirming ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Approve and publish</h3>
                <p className="text-sm text-text-muted">
                  Generates payslip PDFs + signature report and notifies
                  employees. Cannot be undone except by re-running payroll.
                </p>
              </div>
              <Button
                onClick={() => setConfirming(true)}
                disabled={unresolvedAlerts > 0 && !confirming}
              >
                <CircleCheck className="h-4 w-4" /> Approve
              </Button>
            </div>
            {unresolvedAlerts > 0 && (
              <p className="text-xs text-amber-700">
                {unresolvedAlerts} unresolved alert{unresolvedAlerts === 1 ? "" : "s"}.
                Resolve them or accept that they&apos;ll be in the audit trail.
              </p>
            )}
          </>
        ) : (
          <form
            action={async () => {
              setPending(true);
              setError(null);
              const result = await approveRunAction(runId);
              setPending(false);
              if (result?.error) {
                setError(result.error);
                setConfirming(false);
              }
            }}
          >
            <p className="text-sm font-medium">
              Publishing payroll for {totals.employees} employee{totals.employees === 1 ? "" : "s"}
            </p>
            <p className="text-sm mt-1">
              Net (rounded ‒ what gets paid):{" "}
              <span className="font-semibold text-base">
                <MoneyDisplay cents={totals.rounded} monospace={false} />
              </span>
            </p>
            <p className="text-xs text-text-muted">
              Gross (before rounding):{" "}
              <MoneyDisplay cents={totals.gross} monospace={false} />
            </p>
            <p className="text-xs text-text-muted mt-1 mb-3">
              Confirm to generate PDFs, persist payslips, and notify recipients.
            </p>
            {error && <p className="text-sm text-red-700 mb-2">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Publishing…" : "Confirm publish"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (state === "AWAITING_EMPLOYEE_FIXES") {
    return (
      <div className="rounded-card border border-amber-200 bg-amber-50/40 p-4 flex items-center justify-between gap-3">
        <span className="text-sm text-amber-900">
          Waiting on {unresolvedAlerts} fix{unresolvedAlerts === 1 ? "" : "es"}.
          You can advance to review now and the missing data shows up as
          alerts in the run.
        </span>
        <form
          action={async () => {
            setPending(true);
            setError(null);
            const result = await advanceToReviewAction(runId);
            setPending(false);
            if (result?.error) setError(result.error);
          }}
        >
          <Button type="submit" variant="secondary" disabled={pending}>
            <PlayCircle className="h-4 w-4" />{" "}
            {pending ? "Advancing…" : "Advance to review"}
          </Button>
        </form>
      </div>
    );
  }

  if (state === "INGEST_FAILED" || state === "FAILED") {
    return (
      <div className="rounded-card border-2 border-red-200 bg-red-50/40 p-4 flex items-center justify-between gap-3">
        <span className="text-sm text-red-800">
          Run {state.toLowerCase()}. Retry ingest to try again.
        </span>
        <form
          action={async () => {
            setPending(true);
            setError(null);
            const result = await retryIngestAction(runId);
            setPending(false);
            if (result?.error) setError(result.error);
          }}
        >
          <Button type="submit" variant="destructive" disabled={pending}>
            <RefreshCw className="h-4 w-4" /> {pending ? "Retrying…" : "Retry ingest"}
          </Button>
        </form>
      </div>
    );
  }

  if (state === "INGESTING" || state === "APPROVED" || state === "SCHEDULED") {
    return (
      <p className="text-sm text-text-muted">
        Run is {state.toLowerCase()}. The next state transition happens
        automatically.
      </p>
    );
  }

  // CANCELLED — no-op.
  return (
    <form
      action={async () => {
        setPending(true);
        await cancelRunAction(runId);
        setPending(false);
      }}
    >
      <Button type="submit" variant="ghost" disabled={pending}>
        <CircleX className="h-4 w-4" /> Cancel run
      </Button>
    </form>
  );
}
