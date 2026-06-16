"use client";

import * as React from "react";
import Link from "next/link";
import { Play, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = {
  id: string;
  state: string;
  ingestStartedAt: string | null;
  ingestCompletedAt: string | null;
  lastError: string | null;
};

const TERMINAL_STATES = new Set([
  "AWAITING_EMPLOYEE_FIXES",
  "AWAITING_ADMIN_REVIEW",
  "INGEST_FAILED",
  "FAILED",
]);

/**
 * NGTeco "Run Now" trigger. POSTs /api/ngteco/run-now, then polls
 * /api/ngteco/runs/[id]/status every 2s until a terminal state.
 */
export function NgtecoRunNowButton({
  size = "md",
}: {
  size?: "sm" | "md";
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<Status | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function startRun() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const resp = await fetch("/api/ngteco/run-now", { method: "POST" });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        setError(text || `HTTP ${resp.status}`);
        setBusy(false);
        return;
      }
      const json = (await resp.json()) as { runId: string };
      setStatus({
        id: json.runId,
        state: "SCHEDULED",
        ingestStartedAt: null,
        ingestCompletedAt: null,
        lastError: null,
      });
      // Begin polling.
      pollRef.current = setInterval(async () => {
        const sresp = await fetch(`/api/ngteco/runs/${json.runId}/status`);
        if (!sresp.ok) return;
        const s = (await sresp.json()) as Status;
        setStatus(s);
        if (TERMINAL_STATES.has(s.state)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
        }
      }, 2_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start.");
      setBusy(false);
    }
  }

  const ok =
    status?.state === "AWAITING_ADMIN_REVIEW" ||
    status?.state === "AWAITING_EMPLOYEE_FIXES";
  const failed =
    status?.state === "INGEST_FAILED" || status?.state === "FAILED";
  const panelOpen = confirming || !!status;

  // The trigger button always renders at a constant size and stays in the
  // button row; the confirm + status UI floats in an absolutely-positioned
  // panel below it. That way changing state never reflows the sibling
  // buttons (Open period / Upload CSV) — they used to jump on every click.
  return (
    <div className="relative inline-block">
      <Button
        size={size === "sm" ? "sm" : "default"}
        onClick={() => {
          if (status) return;
          setConfirming((c) => !c);
        }}
      >
        <Play className="h-4 w-4" /> Run NGTeco import now
      </Button>

      {panelOpen && (
        <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-card border border-border bg-surface p-3 shadow-pop">
          {status ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {ok ? (
                  <CheckCircle2 className="h-4 w-4 text-success-700" />
                ) : failed ? (
                  <AlertTriangle className="h-4 w-4 text-danger-600" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-brand-700" />
                )}
                <span className="font-medium">
                  {status.state.replace(/_/g, " ")}
                </span>
              </div>
              {status.lastError && (
                <p className="text-xs text-danger-700">{status.lastError}</p>
              )}
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/payroll/run/${status.id}`}>Open run</Link>
                </Button>
                {!busy && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setStatus(null);
                      setConfirming(false);
                    }}
                  >
                    Run another
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                Pull punches from NGTeco for the current period. This may take a
                minute.
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={busy} onClick={startRun}>
                  {busy ? "Starting…" : "Yes, run now"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
              {error && <p className="text-xs text-danger-700">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
