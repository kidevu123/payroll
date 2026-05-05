"use client";

import * as React from "react";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { assignPeriodScheduleAction } from "../actions";

type ScheduleOpt = {
  id: string;
  name: string;
  kind: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";
};

/**
 * Inline schedule-assigner. Surfaces on the period detail header
 * whenever a period has no pay_schedule_id attached. Owner directive:
 * "if it's unassigned how the fuck do you assign it" — this is the
 * answer. Pick a schedule, click Save, period gets tagged + the page
 * reloads with the matching cadence.
 */
export function AssignScheduleButton({
  periodId,
  schedules,
}: {
  periodId: string;
  schedules: ScheduleOpt[];
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [scheduleId, setScheduleId] = React.useState("");

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Tag className="h-3.5 w-3.5" /> Assign schedule
      </Button>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <select
        value={scheduleId}
        onChange={(e) => setScheduleId(e.target.value)}
        disabled={pending}
        className="h-8 rounded-input border border-border/70 bg-surface px-2 text-xs"
      >
        <option value="">Choose…</option>
        {schedules.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.kind.toLowerCase().replace("_", " ")})
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        disabled={pending || !scheduleId}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const fd = new FormData();
            fd.set("payScheduleId", scheduleId);
            const r = await assignPeriodScheduleAction(periodId, fd);
            if (r?.error) {
              setError(r.error);
              return;
            }
            // Reload to pick up the new schedule everywhere on the page.
            window.location.reload();
          } catch {
            setError("Couldn't save schedule. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
      >
        Cancel
      </Button>
      {error && <span className="text-xs text-danger-700">{error}</span>}
    </div>
  );
}
