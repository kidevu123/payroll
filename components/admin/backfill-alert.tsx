"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  backfillPollAction,
  type PollNowResult,
} from "@/app/(admin)/payroll/actions";

/* Surfaced on /time only when there's something to act on — i.e.,
 * the page found N open IN-only punches dated BEFORE today. The cron
 * handles routine 4h-stale gaps automatically; this banner exists for
 * the residual case where auto-recovery hasn't caught everything yet
 * (NGTeco's view didn't refresh fast enough, scrape failed, etc.) so
 * an operator who's looking at the grid and sees the column of yellow
 * "open" cells can resolve them without leaving the page.
 *
 * Click → runs a 3-day backfill (covers the common "yesterday + maybe
 * day before" case). Importer dedupes by hash + open-punch fallback,
 * so re-running is always safe. */
export function BackfillAlert({
  openCountFromPriorDays,
}: {
  openCountFromPriorDays: number;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PollNowResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const r = await backfillPollAction(3);
    setBusy(false);
    setResult(r);
  }

  // Once a backfill returns, show the result chip in place of the
  // call-to-action. Operator can dismiss with a refresh.
  if (result) {
    if ("error" in result) {
      return (
        <div className="flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Backfill failed: {result.error}</span>
        </div>
      );
    }
    return (
      <div className="flex items-start gap-2 rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Backfill queued. You can leave this page; it will keep running in the
          background.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-[200px]">
        {openCountFromPriorDays} open shift
        {openCountFromPriorDays === 1 ? "" : "s"} from prior days look like a
        sync gap. Auto-recovery should close them on the next cron tick — or run
        a backfill now.
      </span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={run}>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Running…
          </>
        ) : (
          <>Backfill last 3 days</>
        )}
      </Button>
    </div>
  );
}
