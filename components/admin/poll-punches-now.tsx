"use client";

import * as React from "react";
import { Activity, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  pollNowAction,
  type PollNowResult,
} from "@/app/(admin)/payroll/actions";

type LastPoll = {
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean;
  triggeredBy: string;
  pairsInserted: number | null;
  pairsUpdated: number | null;
  errorMessage: string | null;
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
}

export function PollPunchesNowButton({
  initialLast,
}: {
  initialLast: LastPoll | null;
}) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PollNowResult | null>(null);
  const [last, setLast] = React.useState<LastPoll | null>(initialLast);

  async function onClick() {
    setBusy(true);
    setResult(null);
    const r = await pollNowAction();
    setBusy(false);
    setResult(r);
    if ("ok" in r) {
      // Refresh the displayed last-poll badge from what we just produced
      // — saves a roundtrip back to the server.
      setLast({
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        ok: r.summary.ok,
        triggeredBy: "MANUAL",
        pairsInserted: r.summary.pairsInserted ?? null,
        pairsUpdated: r.summary.pairsUpdated ?? null,
        errorMessage: r.summary.reason ?? null,
      });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClick}>
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Polling…
            </>
          ) : (
            <>
              <Activity className="h-4 w-4" /> Poll punches now
            </>
          )}
        </Button>
        {last && (
          <span className="text-xs text-text-muted">
            Last:{" "}
            <span className={last.ok ? "" : "text-red-700"}>
              {formatRelative(last.startedAt)}
            </span>
            {last.ok && last.pairsInserted !== null && (
              <>
                {" · "}
                {last.pairsInserted} new
                {last.pairsUpdated !== null && last.pairsUpdated > 0
                  ? `, ${last.pairsUpdated} updated`
                  : ""}
              </>
            )}
            {!last.ok && last.errorMessage && (
              <>
                {" · "}
                <span className="text-red-700">{last.errorMessage}</span>
              </>
            )}
          </span>
        )}
      </div>

      {result && "error" in result && (
        <div className="flex items-start gap-2 rounded-card border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{result.error}</span>
        </div>
      )}
      {result && "ok" in result && (
        <div className="flex items-start gap-2 rounded-card border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {result.summary.ok
              ? `Imported ${result.summary.pairsInserted ?? 0} new punch pair${
                  (result.summary.pairsInserted ?? 0) === 1 ? "" : "s"
                }${
                  result.summary.pairsUpdated && result.summary.pairsUpdated > 0
                    ? `, updated ${result.summary.pairsUpdated}`
                    : ""
                }${
                  result.summary.unmatchedRefs && result.summary.unmatchedRefs > 0
                    ? `, ${result.summary.unmatchedRefs} unmatched employees`
                    : ""
                }.`
              : `Skipped: ${result.summary.reason ?? "unknown"}`}
          </span>
        </div>
      )}
    </div>
  );
}
