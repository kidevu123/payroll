"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import type { Punch } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PunchRow } from "@/components/domain/punch-row";
import {
  createPunchAction,
  editPunchAction,
  voidPunchAction,
} from "../../../actions";

function toLocalInputValue(d: Date | null, timezone: string): string {
  if (!d) return "";
  // Render with company TZ for the input — convert to wall clock then to YYYY-MM-DDTHH:mm.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function PunchEditor({
  periodId,
  employeeId,
  date,
  timezone,
  punches,
  suggestedClockIn,
  suggestedClockOut,
  periodLocked,
}: {
  periodId: string;
  employeeId: string;
  date: string;
  timezone: string;
  punches: Punch[];
  suggestedClockIn: string;
  suggestedClockOut: string;
  periodLocked: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Existing punches</h2>
        {punches.length === 0 ? (
          <p className="text-sm text-[--text-muted]">No punches recorded for this day.</p>
        ) : (
          punches.map((p) => (
            <EditablePunch
              key={p.id}
              punch={p}
              timezone={timezone}
              periodLocked={periodLocked}
            />
          ))
        )}
      </div>

      {!periodLocked && (
        <div className="space-y-2 rounded-[--radius-card] border border-dashed border-[--border] bg-[--surface] p-5">
          <h2 className="text-lg font-semibold">Add manual punch</h2>
          <p className="text-xs text-[--text-muted]">
            Source will be MANUAL_ADMIN. Editing later preserves the original
            timestamps and requires a reason.
          </p>
          <CreateForm
            periodId={periodId}
            employeeId={employeeId}
            date={date}
            timezone={timezone}
            suggestedClockIn={suggestedClockIn}
            suggestedClockOut={suggestedClockOut}
          />
        </div>
      )}
      {periodLocked && (
        <p className="text-sm text-[--text-muted]">
          Period is locked. Unlock from Payroll to make changes.
        </p>
      )}
    </div>
  );
}

function CreateForm({
  periodId,
  employeeId,
  date,
  timezone,
  suggestedClockIn,
  suggestedClockOut,
}: {
  periodId: string;
  employeeId: string;
  date: string;
  timezone: string;
  suggestedClockIn: string;
  suggestedClockOut: string;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        form.set("periodId", periodId);
        form.set("employeeId", employeeId);
        form.set("date", date);
        const result = await createPunchAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="clockIn">Clock in</Label>
          <Input
            id="clockIn"
            name="clockIn"
            type="datetime-local"
            defaultValue={toLocalInputValue(new Date(suggestedClockIn), timezone)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="clockOut">Clock out (optional)</Label>
          <Input
            id="clockOut"
            name="clockOut"
            type="datetime-local"
            defaultValue={toLocalInputValue(new Date(suggestedClockOut), timezone)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Input id="notes" name="notes" maxLength={500} />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add punch"}
        </Button>
      </div>
    </form>
  );
}

function EditablePunch({
  punch,
  timezone,
  periodLocked,
}: {
  punch: Punch;
  timezone: string;
  periodLocked: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [voidOpen, setVoidOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (punch.voidedAt) {
    return (
      <PunchRow
        punch={punch}
        timezone={timezone}
        rightSlot={<span className="text-xs text-[--text-muted]">voided</span>}
      />
    );
  }

  if (!editing && !voidOpen) {
    return (
      <PunchRow
        punch={punch}
        timezone={timezone}
        rightSlot={
          periodLocked ? null : (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setVoidOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )
        }
      />
    );
  }

  if (voidOpen) {
    return (
      <form
        action={async (form) => {
          setPending(true);
          setError(null);
          const result = await voidPunchAction(punch.id, form);
          setPending(false);
          if (result?.error) setError(result.error);
          else setVoidOpen(false);
        }}
        className="space-y-2 rounded-[--radius-card] border border-red-200 bg-red-50/40 p-3 text-sm"
      >
        <p className="font-medium">Void this punch?</p>
        <Input name="reason" required minLength={1} maxLength={500} placeholder="Reason for void" />
        {error && <p className="text-red-700">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            Confirm void
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setVoidOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await editPunchAction(punch.id, form);
        setPending(false);
        if (result?.error) setError(result.error);
        else setEditing(false);
      }}
      className="space-y-2 rounded-[--radius-card] border border-amber-200 bg-amber-50/40 p-3 text-sm"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Clock in</Label>
          <Input
            name="clockIn"
            type="datetime-local"
            defaultValue={toLocalInputValue(punch.clockIn, timezone)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Clock out</Label>
          <Input
            name="clockOut"
            type="datetime-local"
            defaultValue={toLocalInputValue(punch.clockOut, timezone)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Reason (required)</Label>
        <Input name="reason" required minLength={1} maxLength={500} />
      </div>
      <div className="space-y-1">
        <Label>Notes</Label>
        <Input name="notes" maxLength={500} defaultValue={punch.notes ?? ""} />
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
