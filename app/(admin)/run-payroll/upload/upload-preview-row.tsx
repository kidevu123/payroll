"use client";

// One row of the CSV preview, with its inline add-employee form.
import * as React from "react";
import type { PaySchedule } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { createEmployeeFromCsvAction, type CsvPreviewEmployee } from "./actions";

/**
 * One row in the CSV preview list. Handles its own "+ Add as new"
 * inline form so the page never has to navigate away. The form
 * collects the minimum needed to create a real Employee row (legal
 * name, hourly rate, optional schedule); on save the row in the
 * parent preview swaps from "unmatched" to a regular checkbox row.
 */
export function PreviewRow({
  row,
  schedules,
  selected,
  onToggle,
  onCreated,
}: {
  row: CsvPreviewEmployee;
  schedules: PaySchedule[];
  selected: Set<string>;
  onToggle: (employeeId: string, on: boolean) => void;
  onCreated: (merged: CsvPreviewEmployee) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(row.displayName);
  const [rate, setRate] = React.useState("");
  const [scheduleId, setScheduleId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isSelectable = row.employeeId !== null;
  const isChecked =
    row.employeeId !== null && selected.has(row.employeeId);

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 mt-1"
          checked={isChecked}
          disabled={!isSelectable}
          onChange={(ev) => {
            if (!row.employeeId) return;
            onToggle(row.employeeId, ev.target.checked);
          }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate flex items-center gap-2 flex-wrap">
            <span className="truncate">{row.displayName}</span>
            {row.unmatched && !open && (
              <span className="rounded-input bg-warning-100 px-1.5 py-0.5 text-[10px] text-warning-800">
                No match (ref: {row.ngtecoRef})
              </span>
            )}
            {row.payType === "SALARIED" && (
              <span className="rounded-input bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300">
                Salaried — paystub upload only
              </span>
            )}
            {row.unmatched && !open && (
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  setError(null);
                }}
                className="text-[11px] text-brand-700 underline underline-offset-2 hover:no-underline"
              >
                + Add as employee
              </button>
            )}
          </p>
          <p className="text-xs text-text-muted">
            {row.dayCount} day{row.dayCount === 1 ? "" : "s"} ·{" "}
            {row.totalHours.toFixed(2)} h
            {row.payScheduleName && ` · ${row.payScheduleName}`}
          </p>
        </div>
      </div>

      {open && row.unmatched && (
        <div className="mt-2 ml-7 rounded-card border border-warning-200/80 bg-warning-50/60 p-3 space-y-2">
          <p className="text-micro uppercase text-warning-700">
            New employee · ref {row.ngtecoRef}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="space-y-1 text-[11px]">
              <span className="text-text-muted">Display name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-input border border-border/70 bg-surface px-2.5 h-9 text-sm"
                disabled={pending}
              />
            </label>
            <label className="space-y-1 text-[11px]">
              <span className="text-text-muted">Hourly rate</span>
              <input
                type="text"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="13.50"
                className="w-full rounded-input border border-border/70 bg-surface px-2.5 h-9 text-sm tabular-nums"
                disabled={pending}
              />
            </label>
            <label className="space-y-1 text-[11px]">
              <span className="text-text-muted">Pay schedule</span>
              <select
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
                disabled={pending}
                className="w-full rounded-input border border-border/70 bg-surface px-2 h-9 text-sm"
              >
                <option value="">Unassigned</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="text-xs text-danger-700">{error}</p>}
          <div className="flex items-center justify-end gap-2">
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
            <Button
              type="button"
              size="sm"
              disabled={pending || !name.trim() || !rate.trim()}
              onClick={async () => {
                setPending(true);
                setError(null);
                const fd = new FormData();
                fd.set("ngtecoRef", row.ngtecoRef);
                fd.set("displayName", name.trim());
                fd.set("hourlyRateDollars", rate.trim());
                if (scheduleId) fd.set("payScheduleId", scheduleId);
                const r = await createEmployeeFromCsvAction(fd);
                setPending(false);
                if ("error" in r) {
                  setError(r.error);
                  return;
                }
                onCreated(r.row);
              }}
            >
              {pending ? "Saving…" : "Save & include"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
