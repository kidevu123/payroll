"use client";

import * as React from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearAllCronAction } from "./clear-cron";

/**
 * Two-step destructive button — type "wipe cron" to confirm. Deletes
 * every row in pgboss.schedule and cancels every queued/active job.
 */
export function ClearCronButton({ disabledReason }: { disabledReason?: string }) {
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<
    { schedulesDeleted: number; jobsCancelled: number } | null
  >(null);

  if (disabledReason) {
    return (
      <div className="rounded-card border border-border bg-surface-2 p-4 space-y-2 opacity-70">
        <h3 className="font-semibold flex items-center gap-2">
          <Trash2 className="h-4 w-4" /> Clear all cron entries
        </h3>
        <p className="text-xs text-text-muted">{disabledReason}</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="rounded-card border border-success-200 bg-success-50 p-4 space-y-1">
        <h3 className="font-semibold text-success-700">Cron cleared</h3>
        <p className="text-xs text-text-muted">
          Deleted {result.schedulesDeleted} schedule
          {result.schedulesDeleted === 1 ? "" : "s"} and cancelled{" "}
          {result.jobsCancelled} pending/active job
          {result.jobsCancelled === 1 ? "" : "s"}. The next pg-boss tick
          will run zero scheduled work because the cronEnabled flag is
          off.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-danger-200 bg-danger-50 p-4 space-y-3">
      <h3 className="font-semibold text-danger-700 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> Clear all cron entries
      </h3>
      <p className="text-xs text-text-muted">
        Deletes every row in pg-boss&apos;s schedule table and cancels
        every queued / active job. The cronEnabled master flag must be
        off so the boss doesn&apos;t re-register on the next tick. Use
        when you suspect duplicate jobs from stale schedules.
      </p>
      {!open ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-4 w-4" /> Clear cron entries
        </Button>
      ) : (
        <form
          action={async () => {
            if (confirm.trim() !== "wipe cron") {
              setError("Type 'wipe cron' to confirm.");
              return;
            }
            setPending(true);
            setError(null);
            const r = await clearAllCronAction();
            setPending(false);
            if ("error" in r) setError(r.error);
            else setResult({ schedulesDeleted: r.schedulesDeleted, jobsCancelled: r.jobsCancelled });
          }}
          className="space-y-2"
        >
          <p className="text-xs font-medium">
            Type <span className="font-mono">wipe cron</span> to confirm:
          </p>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="wipe cron"
            autoFocus
          />
          {error && <p className="text-xs text-red-700">{error}</p>}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={pending || confirm.trim() !== "wipe cron"}
            >
              {pending ? "Clearing…" : "Confirm wipe"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setConfirm("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
