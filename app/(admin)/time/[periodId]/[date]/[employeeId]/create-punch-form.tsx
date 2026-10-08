"use client";

// Add a manual punch for the day.
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createPunchAction } from "../../../actions";

export function CreateForm({
  periodId,
  employeeId,
  date,
  timezone,
  suggestedClockIn,
  suggestedClockOut,
  returnTo,
}: {
  periodId: string;
  employeeId: string;
  date: string;
  timezone: string;
  suggestedClockIn: string;
  suggestedClockOut: string;
  returnTo: string;
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
        form.set("returnTo", returnTo);
        const result = await createPunchAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="clockIn">Clock in ({timezone})</Label>
          <Input
            id="clockIn"
            name="clockIn"
            type="datetime-local"
            defaultValue={suggestedClockIn}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="clockOut">Clock out ({timezone}, optional)</Label>
          <Input
            id="clockOut"
            name="clockOut"
            type="datetime-local"
            defaultValue={suggestedClockOut}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Input id="notes" name="notes" maxLength={500} />
      </div>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add punch"}
        </Button>
      </div>
    </form>
  );
}
