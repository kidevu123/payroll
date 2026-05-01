"use client";

import * as React from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reportPunchFixAction } from "./actions";

export function ReportFixForm({
  date,
  defaultIn,
  defaultOut,
}: {
  date: string;
  defaultIn?: string;
  defaultOut?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Flag className="h-4 w-4" /> Report a fix for this day
      </Button>
    );
  }

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await reportPunchFixAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-3 rounded-card border border-border bg-surface-2 p-4 shadow-sm"
    >
      <input type="hidden" name="date" value={date} />
      <p className="text-sm text-text-muted">
        Tell admin what the correct in / out times should be for {date}. They
        review on /requests and apply the fix.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="claimedClockIn">Correct clock in</Label>
          <Input
            id="claimedClockIn"
            name="claimedClockIn"
            type="datetime-local"
            defaultValue={defaultIn ?? `${date}T08:00`}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="claimedClockOut">Correct clock out (optional)</Label>
          <Input
            id="claimedClockOut"
            name="claimedClockOut"
            type="datetime-local"
            defaultValue={defaultOut ?? ""}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="reason">What happened?</Label>
        <textarea
          id="reason"
          name="reason"
          required
          minLength={1}
          maxLength={500}
          rows={3}
          placeholder="Forgot to clock out for lunch, left early for a doctor appointment, etc."
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Submitting…" : "Send to admin"}
        </Button>
      </div>
    </form>
  );
}
