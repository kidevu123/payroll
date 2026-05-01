"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type ActionResult = { error?: string } | void;

export function RateForm({
  action,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await action(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-4 rounded-card border border-border bg-surface p-5"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hourlyRateDollars">Hourly rate ($)</Label>
          <Input
            id="hourlyRateDollars"
            name="hourlyRateDollars"
            type="number"
            min={0}
            step={0.01}
            required
            placeholder="25.00"
          />
          <p className="text-xs text-text-muted">
            Type the dollar amount, e.g. 25 or 25.50.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="reason">Reason</Label>
        <Input
          id="reason"
          name="reason"
          maxLength={500}
          placeholder="Annual review / correction / promotion"
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save rate change"}
        </Button>
      </div>
    </form>
  );
}
