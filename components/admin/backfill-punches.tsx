"use client";

import * as React from "react";
import { AlertTriangle, History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  backfillPollAction,
  type PollNowResult,
} from "@/app/(admin)/payroll/actions";
import { usePollStatus } from "@/components/admin/poll-status-provider";

const PRESETS: Array<{ daysBack: number; label: string }> = [
  { daysBack: 1, label: "Yesterday + today" },
  { daysBack: 3, label: "Last 3 days" },
  { daysBack: 7, label: "Last 7 days" },
  { daysBack: 14, label: "Last 14 days" },
  { daysBack: 30, label: "Last 30 days" },
];

export function BackfillPunchesButton(): React.JSX.Element {
  const { startWatching, status, isActive } = usePollStatus();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PollNowResult | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const inProgress = isActive;

  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function run(daysBack: number) {
    setBusy(true);
    setResult(null);
    setOpen(false);
    const r = await backfillPollAction(daysBack);
    setBusy(false);
    setResult(r);
    if ("ok" in r) {
      startWatching(`Backfill (${daysBack} days)`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative inline-block" ref={wrapRef}>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || inProgress}
          onClick={() => setOpen((v) => !v)}
        >
          {busy || inProgress ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Running…
            </>
          ) : (
            <>
              <History className="h-4 w-4" /> Backfill missing days
            </>
          )}
        </Button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-9 z-50 w-56 rounded-card border border-border bg-surface shadow-pop overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-border/70 text-micro uppercase text-text-subtle">
              Re-scan how far back?
            </div>
            {PRESETS.map((p) => (
              <button
                key={p.daysBack}
                type="button"
                onClick={() => run(p.daysBack)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2/40 transition-colors"
              >
                {p.label}
              </button>
            ))}
            <div className="border-t border-border/70 px-3 py-2 text-[11px] text-text-muted">
              Existing punches are deduplicated, so it&apos;s safe to re-run.
            </div>
          </div>
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
