"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
} from "lucide-react";
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
              <Loader2 className="h-4 w-4 animate-spin" /> Backfilling…
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
              Existing punches are deduplicated, so it's safe to re-run.
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
        <div
          className={`flex items-start gap-2 rounded-card border p-2 text-xs ${
            result.summary.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <div className="space-y-1">
            <p>
              {result.summary.ok
                ? `Backfilled ${result.summary.daysCovered ?? "?"} day${
                    (result.summary.daysCovered ?? 0) === 1 ? "" : "s"
                  } · scraped ${result.summary.eventsScraped ?? 0} event${
                    (result.summary.eventsScraped ?? 0) === 1 ? "" : "s"
                  } · imported ${result.summary.pairsInserted ?? 0} new pair${
                    (result.summary.pairsInserted ?? 0) === 1 ? "" : "s"
                  }${
                    result.summary.pairsUpdated && result.summary.pairsUpdated > 0
                      ? `, updated ${result.summary.pairsUpdated}`
                      : ""
                  }${
                    result.summary.unmatchedRefs && result.summary.unmatchedRefs > 0
                      ? `, ${result.summary.unmatchedRefs} unmatched`
                      : ""
                  }.`
                : `Skipped: ${result.summary.reason ?? "unknown"}`}
            </p>
            {result.summary.screenshotPath && (
              <p className="font-mono text-[10px] break-all">
                Failure screenshot saved to{" "}
                <code className="bg-amber-100 px-1 rounded">
                  {result.summary.screenshotPath}
                </code>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
