"use client";

// One existing punch: view, edit in place, or void.
import * as React from "react";
import { Trash2 } from "lucide-react";
import type { Punch } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PunchRow } from "@/components/domain/punch-row";
import { toLocalInputValue } from "@/lib/punches/editor-format";
import { editPunchAction, voidPunchAction } from "../../../actions";

export function EditablePunch({
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
        rightSlot={<span className="text-xs text-text-muted">voided</span>}
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
            <div className="flex items-center gap-1.5 max-sm:w-full max-sm:pt-1 max-sm:[&>button]:min-h-11 max-sm:[&>button]:flex-1">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setVoidOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
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
        className="space-y-2 rounded-card border border-danger-200 bg-danger-50/40 p-3 text-sm"
      >
        <p className="font-medium">Void this punch?</p>
        <Input name="reason" required minLength={1} maxLength={500} placeholder="Reason for void" />
        {error && <p className="text-danger-700">{error}</p>}
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
      className="space-y-2 rounded-card border border-border bg-surface-2 p-3 text-sm"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Clock in ({timezone})</Label>
          <Input
            name="clockIn"
            type="datetime-local"
            defaultValue={toLocalInputValue(punch.clockIn, timezone)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Clock out ({timezone})</Label>
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
      {error && <p className="text-danger-700">{error}</p>}
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
