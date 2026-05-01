"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitMissedPunchAction } from "./actions";

export function MissedPunchForm({
  alertId,
  date,
}: {
  alertId: string;
  date: string;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const r = await submitMissedPunchAction(alertId, form);
        setPending(false);
        if (r?.error) setError(r.error);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="claimedClockIn">Clock in</Label>
          <Input
            id="claimedClockIn"
            name="claimedClockIn"
            type="datetime-local"
            defaultValue={`${date}T08:00`}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="claimedClockOut">Clock out</Label>
          <Input
            id="claimedClockOut"
            name="claimedClockOut"
            type="datetime-local"
            defaultValue={`${date}T16:00`}
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
          className="w-full rounded-[--radius-input] border border-[--border] bg-[--surface] px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Submitting…" : "Submit fix request"}
      </Button>
    </form>
  );
}
