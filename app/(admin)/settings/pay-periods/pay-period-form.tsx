"use client";

import * as React from "react";
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
import type { PayPeriodSettings } from "@/lib/settings/schemas";
import { savePayPeriod } from "./actions";

const DAYS = [
  { v: 0, label: "Sun" },
  { v: 1, label: "Mon" },
  { v: 2, label: "Tue" },
  { v: 3, label: "Wed" },
  { v: 4, label: "Thu" },
  { v: 5, label: "Fri" },
  { v: 6, label: "Sat" },
];

export function PayPeriodForm({
  settings,
  periodCount,
}: {
  settings: PayPeriodSettings;
  periodCount: number;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay periods</CardTitle>
        <CardDescription>
          Length, start-of-week, working days, and (when no periods exist) the
          first-start anchor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            setSaved(false);
            const result = await savePayPeriod(form);
            setPending(false);
            if (result?.error) setError(result.error);
            else setSaved(true);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="lengthDays">Length (days)</Label>
              <Input
                id="lengthDays"
                name="lengthDays"
                type="number"
                min={1}
                max={31}
                defaultValue={settings.lengthDays}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="startDayOfWeek">Start day of week</Label>
              <select
                id="startDayOfWeek"
                name="startDayOfWeek"
                defaultValue={settings.startDayOfWeek}
                className="h-10 w-full rounded-[--radius-input] border border-[--border] bg-[--surface] px-3 text-sm"
              >
                {DAYS.map((d) => (
                  <option key={d.v} value={d.v}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <label
                  key={d.v}
                  className="flex items-center gap-1 rounded-[--radius-chip] border border-[--border] bg-[--surface] px-3 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    name="workingDays"
                    value={d.v}
                    defaultChecked={settings.workingDays.includes(d.v)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="firstStartDate">First start date (optional anchor)</Label>
            <Input
              id="firstStartDate"
              name="firstStartDate"
              type="date"
              defaultValue={settings.firstStartDate ?? ""}
              disabled={periodCount > 0}
            />
            {periodCount > 0 ? (
              <p className="text-xs text-[--text-muted]">
                Locked because {periodCount}{" "}
                {periodCount === 1 ? "period" : "periods"} already exist.
                Resetting requires owner confirmation and a one-shot reset
                flow (not yet wired).
              </p>
            ) : (
              <p className="text-xs text-[--text-muted]">
                Anchors period zero. Without it, periods align to the
                most-recent start-of-week occurrence.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}
          {saved && <p className="text-sm text-emerald-700">Saved.</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
