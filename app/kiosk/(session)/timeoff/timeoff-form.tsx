"use client";

// Kiosk time-off request: pick a type, pick the days, send. Same queue
// and overlap rules as the employee portal, kiosk-scale controls.

import * as React from "react";
import { AlertCircle } from "lucide-react";
import type { KioskCopy } from "@/lib/kiosk/copy";
import { kioskTimeOffAction } from "../../actions";

const FIELD =
  "h-16 w-full rounded-xl border-2 border-border bg-surface px-4 text-2xl font-semibold tabular-nums";

type TimeOffType = "SICK" | "PERSONAL" | "UNPAID" | "OTHER";

export function KioskTimeOffForm({
  copy: c,
  todayIso,
}: {
  copy: KioskCopy;
  todayIso: string;
}) {
  const [type, setType] = React.useState<TimeOffType>("SICK");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const types: { value: TimeOffType; label: string }[] = [
    { value: "SICK", label: c.typeSick },
    { value: "PERSONAL", label: c.typePersonal },
    { value: "UNPAID", label: c.typeUnpaid },
    { value: "OTHER", label: c.typeOther },
  ];

  const errorText = (code: string): string => {
    if (code === "TIME_OFF_OVERLAP") return c.timeOffOverlap;
    if (code === "DATES_BACKWARDS") return c.datesBackwards;
    return code;
  };

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await kioskTimeOffAction(form);
        setPending(false);
        if (result?.error) setError(errorText(result.error));
      }}
      className="space-y-5"
    >
      <input type="hidden" name="type" value={type} />
      <div className="space-y-2">
        <p className="text-xl font-bold">{c.timeOffType}</p>
        <div className="grid grid-cols-2 gap-3">
          {types.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={
                type === value
                  ? "h-16 rounded-xl border-2 border-brand-700 bg-brand-50 px-4 text-xl font-bold text-brand-900"
                  : "h-16 rounded-xl border-2 border-border bg-surface px-4 text-xl font-semibold active:bg-surface-2"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label htmlFor="kiosk-to-start" className="block text-xl font-bold">
            {c.firstDay}
          </label>
          <input
            id="kiosk-to-start"
            name="startDate"
            type="date"
            required
            defaultValue={todayIso}
            min={todayIso}
            className={FIELD}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="kiosk-to-end" className="block text-xl font-bold">
            {c.lastDay}
          </label>
          <input
            id="kiosk-to-end"
            name="endDate"
            type="date"
            defaultValue={todayIso}
            min={todayIso}
            className={FIELD}
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border-2 border-danger-200 bg-danger-50 px-4 py-4 text-lg font-semibold text-danger-700"
        >
          <AlertCircle className="mt-1 h-6 w-6 shrink-0" /> {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-16 w-full rounded-xl bg-brand-700 text-2xl font-bold text-white disabled:opacity-40 active:bg-brand-800"
      >
        {pending ? c.sending : c.send}
      </button>
    </form>
  );
}
