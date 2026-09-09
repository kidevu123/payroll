"use client";

// "Poll punches now" — the button IS the progress indicator (owner: no
// more banner across the top; fill the button). Idle: a plain secondary
// button. Running: a brand tint fills the button left-to-right against
// the expected API duration, with the elapsed seconds and a Stop control.
// Done: the fill goes green (or red) with the outcome for a few seconds,
// then the button settles back and the "Last:" line keeps the result.

import * as React from "react";
import { Activity, AlertTriangle, CheckCircle2, Square, XCircle } from "lucide-react";
import { pollNowAction, type PollNowResult } from "@/app/(admin)/payroll/actions";
import { usePollLastLabel, usePollStatus } from "@/components/admin/poll-status-provider";
import { cn } from "@/lib/utils";

type LastPoll = {
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean;
  triggeredBy: string;
  pairsInserted: number | null;
  pairsUpdated: number | null;
  errorMessage: string | null;
};

/** The API path usually finishes in a few seconds; the fill reaches ~90%
 *  by here and then creeps, so a slow run never looks "done" early. */
const EXPECTED_MS = 20_000;
const OUTCOME_HOLD_MS = 6_000;

function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

export function PollPunchesNowButton({ initialLast }: { initialLast: LastPoll | null }) {
  const { startWatching, status, isActive, cancel } = usePollStatus();
  const lastLabel = usePollLastLabel(initialLast);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PollNowResult | null>(null);

  const running = busy || isActive;
  const startedMs = status?.startedAt ? new Date(status.startedAt).getTime() : null;
  const finishedMs = status?.finishedAt ? new Date(status.finishedAt).getTime() : null;
  // Tick while running and for the outcome hold after it finishes; the
  // interval stops itself once the hold window has passed.
  const now = useNow(
    running || (finishedMs !== null && Date.now() - finishedMs < OUTCOME_HOLD_MS + 500),
  );
  const elapsedS = running && startedMs ? Math.max(0, Math.floor((now - startedMs) / 1000)) : 0;
  // Fill: fast to 90% over EXPECTED_MS, then a slow creep toward 98%.
  const fillPct = running
    ? startedMs
      ? Math.min(98, 90 * Math.min(1, (now - startedMs) / EXPECTED_MS) + 8 * Math.min(1, (now - startedMs) / (EXPECTED_MS * 6)))
      : 6
    : 0;
  // Outcome flash: the poll just finished (within the hold window).
  const justFinished =
    !running && finishedMs !== null && now - finishedMs < OUTCOME_HOLD_MS && status !== null;
  const outcome = justFinished ? (status?.ok ? "ok" : "fail") : null;

  const last = status?.startedAt
    ? {
        startedAt: status.startedAt,
        finishedAt: status.finishedAt,
        ok: status.ok,
        pairsInserted: status.pairsInserted,
        pairsUpdated: status.pairsUpdated,
        errorMessage: status.errorMessage,
      }
    : initialLast;

  async function onClick() {
    setBusy(true);
    setResult(null);
    const r = await pollNowAction();
    setBusy(false);
    setResult(r);
    if ("ok" in r) startWatching("Poll punches");
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center">
          <button
            type="button"
            onClick={onClick}
            disabled={running}
            aria-live="polite"
            className={cn(
              "relative inline-flex h-9 min-w-[11rem] items-center justify-center gap-2 overflow-hidden rounded-input border px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60",
              outcome === "ok"
                ? "border-success-200 bg-success-50 text-success-700"
                : outcome === "fail"
                  ? "border-danger-200 bg-danger-50 text-danger-700"
                  : running
                    ? "border-brand-200 bg-surface text-brand-800"
                    : "border-border bg-surface text-text shadow-[0_1px_2px_0_rgb(15_23_42_/_0.04)] hover:border-border-strong hover:bg-surface-2/40",
              running && "rounded-r-none border-r-0",
            )}
          >
            {/* Fill layer: grows with elapsed time while running. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-brand-100 transition-[width] duration-300 ease-out"
              style={{ width: running ? `${fillPct}%` : "0%" }}
            />
            <span className="relative inline-flex items-center gap-2 tabular-nums">
              {outcome === "ok" ? (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Synced
                  {status?.pairsInserted !== null && status?.pairsInserted !== undefined
                    ? ` · ${status.pairsInserted} new`
                    : ""}
                </>
              ) : outcome === "fail" ? (
                <>
                  <XCircle className="h-4 w-4" /> Poll failed
                </>
              ) : running ? (
                <>
                  <Activity className="h-4 w-4 animate-pulse" /> Polling… {elapsedS}s
                </>
              ) : (
                <>
                  <Activity className="h-4 w-4" /> Poll punches now
                </>
              )}
            </span>
          </button>
          {running && (
            <button
              type="button"
              onClick={cancel}
              title="Stop this poll"
              aria-label="Stop this poll"
              className="inline-flex h-9 items-center justify-center rounded-r-input border border-brand-200 bg-surface px-2.5 text-danger-700 transition-colors hover:bg-danger-50"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {last && !running && (
          <span
            className="min-w-0 max-w-[22rem] truncate text-xs text-text-muted"
            title={lastLabel + (last.errorMessage ? ` · ${last.errorMessage}` : "")}
          >
            Last: <span className={last.ok ? "" : "text-danger-700"}>{lastLabel}</span>
            {last.ok && last.pairsInserted !== null && (
              <>
                {" · "}
                {last.pairsInserted} new
                {last.pairsUpdated !== null && last.pairsUpdated > 0 ? `, ${last.pairsUpdated} updated` : ""}
              </>
            )}
            {!last.ok && last.errorMessage && (
              <>
                {" · "}
                <span className="text-danger-700">{last.errorMessage}</span>
              </>
            )}
          </span>
        )}
      </div>

      {result && "error" in result && (
        <div className="flex items-start gap-2 rounded-card border border-danger-200 bg-danger-50 p-2 text-xs text-danger-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{result.error}</span>
        </div>
      )}
    </div>
  );
}
