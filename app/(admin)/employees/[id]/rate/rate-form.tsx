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
      className="space-y-4 rounded-[--radius-card] border border-[--border] bg-[--surface] p-5"
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
          <Label htmlFor="hourlyRateCents">Hourly rate (cents)</Label>
          <Input
            id="hourlyRateCents"
            name="hourlyRateCents"
            type="number"
            min={0}
            step={1}
            required
            placeholder="2500 = $25.00/hr"
          />
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
