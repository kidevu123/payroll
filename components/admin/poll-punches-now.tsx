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
  const { startWatching, status, watch, cancel } = usePollStatus();
  const lastLabel = usePollLastLabel(initialLast);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PollNowResult | null>(null);
  // Anchor the whole animation on the CLICK, not on the server's status
  // feed: the feed arrives every 2s, so a fill keyed to it sat still and
  // then jumped ("reacts, stops, then moves").
  const [clickedAt, setClickedAt] = React.useState<number | null>(null);
  // The poll-log row id that was current when the button was clicked. The
  // poll THIS click started is a different row, so "finished" means a
  // different id with a finishedAt — a stale result from a second ago can
  // no longer end the animation on the spot.
  const [idAtClick, setIdAtClick] = React.useState<string | null | undefined>(undefined);

  const finishedMs = status?.finishedAt ? new Date(status.finishedAt).getTime() : null;
  const finishedAfterClick =
    clickedAt !== null &&
    idAtClick !== undefined &&
    !!status?.id &&
    status.id !== idAtClick &&
    finishedMs !== null;
  // "In flight" from the server's point of view. NOT the provider's
  // isActive — that stays true while the old banner would have been
  // visible (45s after success), which left the button on "Polling…"
  // long after the poll had finished.
  const serverRunning =
    status?.phase === "running" ||
    status?.phase === "stuck" ||
    (!!watch && status?.phase !== "succeeded" && status?.phase !== "failed" && !finishedAfterClick);
  // Keep the running state on screen for at least a beat: a 1-second API
  // poll otherwise flashes and reads as "the button just twitched".
  const MIN_RUNNING_MS = 1_200;
  const rawRunning = busy || serverRunning || (clickedAt !== null && !finishedAfterClick);
  const now = useNow(
    rawRunning ||
      (clickedAt !== null && Date.now() - clickedAt < MIN_RUNNING_MS + 500) ||
      (finishedMs !== null && Date.now() - finishedMs < OUTCOME_HOLD_MS + 500),
  );
  const running = rawRunning || (clickedAt !== null && now - clickedAt < MIN_RUNNING_MS);
  const elapsedS = running && clickedAt !== null ? Math.max(0, Math.floor((now - clickedAt) / 1000)) : 0;
  // Outcome flash: the poll finished after this click, within the hold window.
  const justFinished = !running && finishedAfterClick && finishedMs !== null && now - finishedMs < OUTCOME_HOLD_MS;
  const outcome = justFinished ? (status?.ok ? "ok" : "fail") : null;

  // Release the click anchor once the outcome has been shown.
  React.useEffect(() => {
    if (clickedAt !== null && !running && !justFinished) {
      setClickedAt(null);
      setIdAtClick(undefined);
    }
  }, [clickedAt, running, justFinished]);

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
    setClickedAt(Date.now());
    setIdAtClick(status?.id ?? null);
    const r = await pollNowAction();
    setBusy(false);
    setResult(r);
    if ("ok" in r) startWatching("Poll punches");
    else {
      setClickedAt(null);
      setIdAtClick(undefined);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center">
          <button
            type="button"
            onClick={onClick}
            disabled={running || outcome !== null}
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
            {/* Fill layer: a single CSS animation from the click — fast at
                first (the API usually answers in seconds), then creeping so
                a slow run never looks finished early. Keyed on clickedAt so
                each click restarts it. */}
            {running && (
              <span
                key={clickedAt ?? 0}
                aria-hidden
                className="absolute inset-y-0 left-0 bg-brand-100 motion-safe:animate-[poll-fill_40s_cubic-bezier(0.15,0.8,0.25,1)_forwards]"
              />
            )}
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
