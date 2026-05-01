"use client";

import * as React from "react";
import { Plus, Power, PowerOff } from "lucide-react";
import type { PaySchedule } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createScheduleAction,
  toggleActiveAction,
  updateScheduleAction,
} from "./actions";

const KIND_LABEL: Record<PaySchedule["periodKind"], string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-Weekly",
  SEMI_MONTHLY: "Semi-Monthly (1-15 / 16-EOM)",
  MONTHLY: "Monthly",
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PaySchedulesManager({
  schedules,
  employeeCounts,
  runCounts,
}: {
  schedules: PaySchedule[];
  employeeCounts: Record<string, number>;
  runCounts: Record<string, number>;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Pay schedules</CardTitle>
          <CardDescription>
            Each employee is assigned to one schedule. The payroll run-tick job
            fires per schedule&apos;s cron and only includes its employees.
          </CardDescription>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add schedule
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {creating && (
          <ScheduleForm
            mode="create"
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              setError(null);
            }}
            onError={setError}
          />
        )}

        {schedules.length === 0 ? (
          <p className="text-sm text-text-muted">No schedules yet.</p>
        ) : (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li
                key={s.id}
                className="rounded-card border border-border bg-surface-2 p-4 shadow-sm"
              >
                {editingId === s.id ? (
                  <ScheduleForm
                    mode="edit"
                    schedule={s}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null);
                      setError(null);
                    }}
                    onError={setError}
                  />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text">{s.name}</span>
                        {!s.active && (
                          <span className="rounded-input bg-surface-3 px-2 py-0.5 text-xs text-text-muted">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                        <span>{KIND_LABEL[s.periodKind]}</span>
                        {s.startDayOfWeek !== null && s.startDayOfWeek !== undefined && (
                          <span>Starts {DOW_LABELS[s.startDayOfWeek]}</span>
                        )}
                        {s.anchorDate && <span>Anchor {s.anchorDate}</span>}
                        <span className="font-mono">{s.cron}</span>
                        <span>
                          {employeeCounts[s.id] ?? 0} active emp
                          {(employeeCounts[s.id] ?? 0) === 1 ? "" : "s"}
                        </span>
                        <span>{runCounts[s.id] ?? 0} runs</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(s.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const result = await toggleActiveAction(s.id, !s.active);
                          if (result?.error) setError(result.error);
                        }}
                      >
                        {s.active ? (
                          <>
                            <PowerOff className="h-3.5 w-3.5" /> Deactivate
                          </>
                        ) : (
                          <>
                            <Power className="h-3.5 w-3.5" /> Activate
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ScheduleForm({
  mode,
  schedule,
  onCancel,
  onSaved,
  onError,
}: {
  mode: "create" | "edit";
  schedule?: PaySchedule;
  onCancel: () => void;
  onSaved: () => void;
  onError: (m: string | null) => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [kind, setKind] = React.useState<PaySchedule["periodKind"]>(
    schedule?.periodKind ?? "WEEKLY",
  );
  const showDow = kind === "WEEKLY" || kind === "BIWEEKLY";
  const showAnchor = kind === "BIWEEKLY";

  return (
    <form
      action={async (form) => {
        setPending(true);
        onError(null);
        const result =
          mode === "create"
            ? await createScheduleAction(form)
            : await updateScheduleAction(schedule!.id, form);
        setPending(false);
        if (result?.error) onError(result.error);
        else onSaved();
      }}
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      <div className="space-y-1">
        <Label htmlFor={`name-${schedule?.id ?? "new"}`}>Name</Label>
        <Input
          id={`name-${schedule?.id ?? "new"}`}
          name="name"
          required
          defaultValue={schedule?.name ?? ""}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`periodKind-${schedule?.id ?? "new"}`}>Cadence</Label>
        <select
          id={`periodKind-${schedule?.id ?? "new"}`}
          name="periodKind"
          value={kind}
          onChange={(e) => setKind(e.target.value as PaySchedule["periodKind"])}
          className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
        >
          <option value="WEEKLY">Weekly</option>
          <option value="BIWEEKLY">Bi-Weekly</option>
          <option value="SEMI_MONTHLY">Semi-Monthly (1-15 / 16-EOM)</option>
          <option value="MONTHLY">Monthly</option>
        </select>
      </div>
      {showDow && (
        <div className="space-y-1">
          <Label htmlFor={`dow-${schedule?.id ?? "new"}`}>Period starts</Label>
          <select
            id={`dow-${schedule?.id ?? "new"}`}
            name="startDayOfWeek"
            defaultValue={String(schedule?.startDayOfWeek ?? 1)}
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            {DOW_LABELS.map((d, i) => (
              <option key={i} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
      {showAnchor && (
        <div className="space-y-1">
          <Label htmlFor={`anchor-${schedule?.id ?? "new"}`}>Anchor date</Label>
          <Input
            id={`anchor-${schedule?.id ?? "new"}`}
            name="anchorDate"
            type="date"
            defaultValue={schedule?.anchorDate ?? ""}
          />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`cron-${schedule?.id ?? "new"}`}>Cron (5-field)</Label>
        <Input
          id={`cron-${schedule?.id ?? "new"}`}
          name="cron"
          required
          defaultValue={schedule?.cron ?? "0 19 * * 0"}
          placeholder="0 19 * * 0"
        />
      </div>
      <div className="flex items-center gap-2 pt-6 sm:col-span-2">
        <input
          id={`active-${schedule?.id ?? "new"}`}
          type="checkbox"
          name="active"
          defaultChecked={schedule?.active ?? true}
          className="h-4 w-4"
        />
        <Label htmlFor={`active-${schedule?.id ?? "new"}`} className="!mt-0">
          Active (job tick will fire on cron)
        </Label>
      </div>
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
