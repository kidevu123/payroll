"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  backfillPollAction,
  type PollNowResult,
} from "@/app/(admin)/payroll/actions";

const PRESETS: Array<{ daysBack: number; label: string }> = [
  { daysBack: 1, label: "Yesterday + today" },
  { daysBack: 3, label: "Last 3 days" },
  { daysBack: 7, label: "Last 7 days" },
  { daysBack: 14, label: "Last 14 days" },
  { daysBack: 30, label: "Last 30 days" },
];

export function BackfillPunchesButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PollNowResult | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

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
  }

  return (
    <div className="space-y-2">
      <div className="relative inline-block" ref={wrapRef}>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Queueing…
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
            <div className="px-3 py-2 border-b border-border/70 text-[11px] uppercase tracking-wider text-text-subtle">
              Re-scan how far back?
            </div>
            {PRESETS.map((p) => (
              <button
                key={p.daysBack}
                type="button"
                onClick={() => run(p.daysBack)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2 transition-colors"
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
        <div className="flex items-start gap-2 rounded-card border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{result.error}</span>
        </div>
      )}
      {result && "ok" in result && (
        <div className="flex items-start gap-2 rounded-card border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Backfill queued. You can leave this page; it will keep running in
            the background.
          </span>
        </div>
      )}
    </div>
  );
}
