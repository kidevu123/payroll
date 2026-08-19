"use client";

// Kiosk punch-fix form: the phone flow's logic at kiosk scale. Native
// time-only pickers, tap-to-fill reason chips, one primary action.

import * as React from "react";
import { AlertCircle } from "lucide-react";
import type { EmployeeReportFixMode } from "@/lib/missed-punch/employee-report-mode";
import type { KioskCopy } from "@/lib/kiosk/copy";
import { kioskReportPunchFixAction } from "../../../actions";

function timeOf(value: string): string {
  const t = value.indexOf("T");
  return t === -1 ? value : value.slice(t + 1);
}

const FIELD =
  "h-16 w-full rounded-xl border-2 border-border bg-surface px-4 text-2xl font-semibold tabular-nums";

function TimeField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={`kiosk-${name}`} className="block text-xl font-bold">
        {label}
      </label>
      <input
        id={`kiosk-${name}`}
        name={name}
        type="time"
        required
        defaultValue={defaultValue}
        className={FIELD}
      />
    </div>
  );
}

export function KioskFixForm({
  date,
  mode,
  copy: c,
}: {
  date: string;
  mode: EmployeeReportFixMode;
  copy: KioskCopy;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [missingSide, setMissingSide] = React.useState<"clockIn" | "clockOut">(
    "clockOut",
  );
  const [reason, setReason] = React.useState("");
  const quickReasons = [c.reasonForgot, c.reasonClock, c.reasonLeftEarly];

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await kioskReportPunchFixAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-5"
    >
      <input type="hidden" name="date" value={date} />
      {mode.kind !== "NO_PUNCH_OR_CORRECTION" ? (
        <input type="hidden" name="issue" value={mode.kind} />
      ) : null}

      {mode.kind === "MISSING_OUT" ? (
        <>
          <p className="rounded-xl border-2 border-border bg-surface-2 px-4 py-4 text-xl">
            {c.onFile}: <strong>{c.in} {mode.recordedClockIn}</strong>
          </p>
          <TimeField
            name="claimedClockOut"
            label={c.whenOut}
            defaultValue={timeOf(mode.defaultClockOut)}
          />
        </>
      ) : mode.kind === "MISSING_IN" ? (
        <>
          <p className="rounded-xl border-2 border-border bg-surface-2 px-4 py-4 text-xl">
            {c.onFile}: <strong>{c.out} {mode.recordedClockOut}</strong>
          </p>
          <TimeField
            name="claimedClockIn"
            label={c.whenIn}
            defaultValue={timeOf(mode.defaultClockIn)}
          />
        </>
      ) : mode.kind === "UNPAIRED_PUNCH" ? (
        <>
          <p className="rounded-xl border-2 border-border bg-surface-2 px-4 py-4 text-xl">
            {c.onFile}: <strong>{mode.recordedUnpairedPunch}</strong>
            <span className="mt-1 block text-lg text-text-muted">
              {c.unpairedHint}
            </span>
          </p>
          <div className="grid gap-3">
            {(
              [
                { side: "clockOut" as const, label: c.forgotOut },
                { side: "clockIn" as const, label: c.forgotIn },
              ]
            ).map(({ side, label }) => (
              <button
                key={side}
                type="button"
                onClick={() => setMissingSide(side)}
                className={
                  missingSide === side
                    ? "h-16 rounded-xl border-2 border-brand-700 bg-brand-50 px-4 text-left text-xl font-bold text-brand-900"
                    : "h-16 rounded-xl border-2 border-border bg-surface px-4 text-left text-xl font-semibold active:bg-surface-2"
                }
              >
                {label}
              </button>
            ))}
          </div>
          {missingSide === "clockOut" ? (
            <TimeField
              name="claimedClockOut"
              label={c.whenOut}
              defaultValue={timeOf(mode.defaultClockOut)}
            />
          ) : (
            <TimeField
              name="claimedClockIn"
              label={c.whenIn}
              defaultValue={timeOf(mode.defaultClockIn)}
            />
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <TimeField
            name="claimedClockIn"
            label={c.clockIn}
            defaultValue={timeOf(mode.defaultClockIn)}
          />
          <TimeField
            name="claimedClockOut"
            label={c.clockOut}
            defaultValue={timeOf(mode.defaultClockOut) || "17:00"}
          />
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xl font-bold">{c.whatHappened}</p>
        <div className="flex flex-wrap gap-3">
          {quickReasons.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={
                reason === r
                  ? "min-h-14 rounded-xl border-2 border-brand-700 bg-brand-50 px-4 py-3 text-lg font-bold text-brand-900"
                  : "min-h-14 rounded-xl border-2 border-border bg-surface px-4 py-3 text-lg font-semibold active:bg-surface-2"
              }
            >
              {r}
            </button>
          ))}
        </div>
        <input type="hidden" name="reason" value={reason} />
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
        disabled={pending || reason.length === 0}
        className="h-18 min-h-16 w-full rounded-xl bg-brand-700 text-2xl font-bold text-white disabled:opacity-40 active:bg-brand-800"
      >
        {pending ? c.sending : c.send}
      </button>
    </form>
  );
}
