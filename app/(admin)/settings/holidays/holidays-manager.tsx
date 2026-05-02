"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Holiday } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createHolidayAction,
  deleteHolidayAction,
} from "./actions";

export function HolidaysManager({ holidays }: { holidays: Holiday[] }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Holidays</h2>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            const result = await createHolidayAction(form);
            setPending(false);
            if (result?.error) setError(result.error);
            else form &&
              (document.getElementById("holiday-form") as HTMLFormElement)?.reset();
          }}
          id="holiday-form"
          className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2 items-end"
        >
          <div className="space-y-1">
            <Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" required maxLength={120} placeholder="Independence Day" />
          </div>
          <Button type="submit" disabled={pending}>
            <Plus className="h-4 w-4" /> {pending ? "Adding…" : "Add"}
          </Button>
        </form>

        {holidays.length === 0 ? (
          <p className="text-sm text-text-muted">No holidays yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border bg-surface-2 shadow-sm">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-text">{h.date}</span>
                  <span className="text-text-muted">{h.label}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Delete "${h.label}" on ${h.date}?`)) return;
                    setPending(true);
                    const result = await deleteHolidayAction(h.id);
                    setPending(false);
                    if (result?.error) setError(result.error);
                  }}
                  className="text-red-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
