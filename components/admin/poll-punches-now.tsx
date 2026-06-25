"use client";

import * as React from "react";
import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  pollNowAction,
  type PollNowResult,
} from "@/app/(admin)/payroll/actions";
import {
  usePollLastLabel,
  usePollStatus,
} from "@/components/admin/poll-status-provider";

type LastPoll = {
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean;
  triggeredBy: string;
  pairsInserted: number | null;
  pairsUpdated: number | null;
  errorMessage: string | null;
};

export function PollPunchesNowButton({
  initialLast,
}: {
  initialLast: LastPoll | null;
}) {
  const { startWatching, status, isActive } = usePollStatus();
  const lastLabel = usePollLastLabel(initialLast);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PollNowResult | null>(null);

  const inProgress = isActive;
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
    if ("ok" in r) {
      startWatching("Poll punches");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || inProgress}
          onClick={onClick}
        >
          {busy || inProgress ? (
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
            <span
              className={
                inProgress
                  ? "text-brand-700 font-medium"
                  : last.ok
                    ? ""
                    : "text-danger-700"
              }
            >
              {lastLabel}
            </span>
            {!inProgress && last.ok && last.pairsInserted !== null && (
              <>
                {" · "}
                {last.pairsInserted} new
                {last.pairsUpdated !== null && last.pairsUpdated > 0
                  ? `, ${last.pairsUpdated} updated`
                  : ""}
              </>
            )}
            {!inProgress && !last.ok && last.errorMessage && (
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
