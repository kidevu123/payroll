"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recomputeAllPayslipsOnPeriodAction } from "../actions";

type DriftEntry = {
  employeeName: string;
  storedHours: number;
  liveHours: number;
};

/**
 * Surfaces stored-vs-live hours drift on a period detail page and lets
 * the admin recompute every active payslip from current punches in one
 * click. Used to repair legacy/double-published runs where the stored
 * hours/gross have baked-in 2x.
 */
export function RecomputeBanner({
  periodId,
  drifts,
}: {
  periodId: string;
  drifts: DriftEntry[];
}) {
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState<{
    ok: number;
    delta: { name: string; before: number; after: number; deltaCents: number }[];
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (drifts.length === 0 && !done) return null;

  async function onRecompute() {
    const ok = window.confirm(
      `Recompute ${drifts.length} payslip${drifts.length === 1 ? "" : "s"} from current punches?\n\nThis OVERWRITES the stored hours/gross/rounded with what computePay says today. Use this when a payslip has stale legacy values (typically 2x the actual hours). Audited per recompute. Run total updates to match the new payslip sum.`,
    );
    if (!ok) return;
    setPending(true);
    setError(null);
    const r = await recomputeAllPayslipsOnPeriodAction(periodId);
    setPending(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setDone({
      ok: r.results.length,
      delta: r.results.map((d) => ({
        name: d.employeeId.slice(0, 8),
        before: d.beforeHours,
        after: d.afterHours,
        deltaCents: d.beforeRoundedCents - d.afterRoundedCents,
      })),
    });
  }

  if (done) {
    const totalRecovered = done.delta.reduce((s, d) => s + d.deltaCents, 0);
    return (
      <div className="rounded-card border border-success-200 bg-success-50 p-4 text-sm text-success-900">
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Recomputed {done.ok} payslip{done.ok === 1 ? "" : "s"}.
          {totalRecovered !== 0 && (
            <span>
              {" "}
              Net adjustment: {totalRecovered > 0 ? "−" : "+"}$
              {Math.abs(totalRecovered / 100).toFixed(2)}.
            </span>
          )}
        </div>
        <p className="mt-1 text-xs">
          Reload the page to see the updated values. Reports + Zoho push
          will use the new totals from now on.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-warning-200 bg-warning-50 p-4 text-sm text-warning-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-2">
        <AlertTriangle className="hidden h-4 w-4 shrink-0 sm:mt-0.5 sm:block text-warning-700" />
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            {drifts.length} payslip{drifts.length === 1 ? "" : "s"} on this
            period {drifts.length === 1 ? "has" : "have"} stored hours that
            don&apos;t match current punches.
          </p>
          <p className="mt-1 text-xs">
            Likely a doubled-publish or legacy import. Click Recompute to
            overwrite the stored hours/gross/rounded with what the punches
            actually add up to. Audited per payslip; the run total
            recomputes from the new payslip sum.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {drifts.slice(0, 8).map((d, i) => (
              <li key={i}>
                {d.employeeName}: stored {d.storedHours.toFixed(2)}h vs
                live {d.liveHours.toFixed(2)}h{" "}
                <span className="text-warning-700">
                  ({d.storedHours - d.liveHours > 0 ? "+" : ""}
                  {(d.storedHours - d.liveHours).toFixed(2)}h)
                </span>
              </li>
            ))}
            {drifts.length > 8 && (
              <li className="text-warning-700">
                …{drifts.length - 8} more
              </li>
            )}
          </ul>
        </div>
        <Button
          size="sm"
          variant="default"
          disabled={pending}
          onClick={onRecompute}
          className="shrink-0 self-start"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {pending
            ? "Recomputing…"
            : `Recompute ${drifts.length} payslip${drifts.length === 1 ? "" : "s"}`}
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-danger-700">{error}</p>
      )}
    </div>
  );
}
