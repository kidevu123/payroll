"use client";

// Complete an unpaired or open punch: the admin supplies the missing side.
import * as React from "react";
import type { Punch } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  composeMissingWallClock,
  inferAmbiguousOnFileRole,
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
  validateAmbiguousPair,
} from "@/lib/punches/missing-punch";
import {
  defaultClockOutGuess,
  formatNgtecoSourceLine,
  formatWallClock,
  formatWallDate,
  toLocalInputValue,
} from "@/lib/punches/editor-format";
import { editPunchAction } from "../../../actions";

/** Focused fix for open shift, missing clock-in, or ambiguous single punch. */
export function FixPunchForm({
  punch,
  timezone,
}: {
  punch: Punch;
  timezone: string;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const ambiguous = isAmbiguousSinglePunch(punch);
  const closeOut = isOpenShiftPunch(punch);
  const missingIn = isMissingClockInPunch(punch);
  const onFileTime = toLocalInputValue(punch.clockIn, timezone);
  const onFileWallLabel = formatWallClock(punch.clockIn, timezone);
  const [onFileRole, setOnFileRole] = React.useState<"clock-in" | "clock-out">(
    () => inferAmbiguousOnFileRole(punch.clockIn, timezone),
  );
  // Time-only entry for the missing side; the date comes from the on-file punch.
  const [missingTime, setMissingTime] = React.useState("");
  const composed = ambiguous
    ? composeMissingWallClock(onFileRole, onFileTime, missingTime)
    : null;
  const composedDayLabel = composed
    ? formatWallDate(composed.wallClock, timezone)
    : null;

  const cleanedNotes =
    punch.notes?.replace(/\bambiguous:single\b/g, "").replace(/\s+/g, " ").trim() ??
    "";

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        if (ambiguous) {
          const built = composeMissingWallClock(
            onFileRole,
            onFileTime,
            String(form.get("missingTime") ?? ""),
          );
          if (!built) {
            setPending(false);
            setError("Enter the missing time (hours and minutes).");
            return;
          }
          const missing = built.wallClock;
          form.delete("missingTime");
          form.set(onFileRole === "clock-in" ? "clockOut" : "clockIn", missing);
          const pairErr = validateAmbiguousPair(
            onFileRole,
            onFileTime,
            missing,
            timezone,
            punch.clockIn,
            () => onFileWallLabel,
          );
          if (pairErr) {
            setPending(false);
            setError(pairErr);
            return;
          }
        }
        const result = await editPunchAction(punch.id, form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-3 rounded-card border-2 border-warning-200 bg-warning-50 p-4"
    >
      {ambiguous ? (
        <>
          <div className="rounded-input bg-surface px-3 py-2 text-sm border border-border">
            <span className="text-micro text-text-muted uppercase">
              On file (time clock)
            </span>
            <p className="mt-1 font-semibold tabular-nums">
              Unpaired punch: {formatWallClock(punch.clockIn, timezone)}
            </p>
            {punch.notes ? (
              <p className="mt-1 text-xs text-text-muted font-normal">
                {formatNgtecoSourceLine(punch.notes)}
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Was the {onFileWallLabel} punch when they arrived or when they
              left?
            </legend>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-input border border-border bg-surface px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                <input
                  type="radio"
                  name="onFileRole"
                  value="clock-in"
                  checked={onFileRole === "clock-in"}
                  onChange={() => setOnFileRole("clock-in")}
                  className="accent-brand-700"
                />
                Clock in
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-input border border-border bg-surface px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                <input
                  type="radio"
                  name="onFileRole"
                  value="clock-out"
                  checked={onFileRole === "clock-out"}
                  onChange={() => setOnFileRole("clock-out")}
                  className="accent-brand-700"
                />
                Clock out
              </label>
            </div>
          </fieldset>

          {onFileRole === "clock-in" ? (
            <>
              <input type="hidden" name="clockIn" value={onFileTime} />
              <div className="space-y-1">
                <Label htmlFor="fix-missingTime">
                  Clock out time on {formatWallDate(onFileTime, timezone)} ({timezone})
                </Label>
                <Input
                  id="fix-missingTime"
                  name="missingTime"
                  type="time"
                  required
                  value={missingTime}
                  onChange={(e) => setMissingTime(e.target.value)}
                  className="max-w-[12rem]"
                />
                <p className="text-xs text-text-muted">
                  {composed && composed.dayOffset === 1
                    ? `Earlier than the ${onFileWallLabel} clock-in, so this counts as an overnight shift ending ${composedDayLabel}.`
                    : `The ${onFileWallLabel} punch stays as clock-in. Enter the time they left.`}
                </p>
              </div>
            </>
          ) : (
            <>
              <input type="hidden" name="clockOut" value={onFileTime} />
              <div className="space-y-1">
                <Label htmlFor="fix-missingTime">
                  Clock in time on {formatWallDate(onFileTime, timezone)} ({timezone})
                </Label>
                <Input
                  id="fix-missingTime"
                  name="missingTime"
                  type="time"
                  required
                  value={missingTime}
                  onChange={(e) => setMissingTime(e.target.value)}
                  className="max-w-[12rem]"
                />
                <p className="text-xs text-text-muted">
                  {composed && composed.dayOffset === -1
                    ? `Later than the ${onFileWallLabel} clock-out, so this counts as an overnight shift starting ${composedDayLabel}.`
                    : `The ${onFileWallLabel} punch stays as clock-out. Enter the time they arrived.`}
                </p>
              </div>
            </>
          )}

          {cleanedNotes ? (
            <input type="hidden" name="notes" value={cleanedNotes} />
          ) : (
            <input type="hidden" name="notes" value="" />
          )}
        </>
      ) : closeOut ? (
        <>
          <div className="rounded-input bg-surface px-3 py-2 text-sm border border-border">
            <span className="text-micro text-text-muted uppercase">
              On file (time clock)
            </span>
            <p className="mt-1 font-semibold tabular-nums">
              Clock in: {formatWallClock(punch.clockIn, timezone)}
            </p>
          </div>
          <input
            type="hidden"
            name="clockIn"
            value={toLocalInputValue(punch.clockIn, timezone)}
          />
          <div className="space-y-1">
            <Label htmlFor="fix-clockOut">Clock out ({timezone})</Label>
            <Input
              id="fix-clockOut"
              name="clockOut"
              type="datetime-local"
              required
              defaultValue={defaultClockOutGuess(punch.clockIn, timezone)}
            />
          </div>
        </>
      ) : missingIn ? (
        <>
          <div className="rounded-input bg-surface px-3 py-2 text-sm border border-border">
            <span className="text-micro text-text-muted uppercase">
              On file (time clock)
            </span>
            <p className="mt-1 font-semibold tabular-nums">
              Clock out:{" "}
              {punch.clockOut
                ? formatWallClock(punch.clockOut, timezone)
                : "—"}
            </p>
          </div>
          <input
            type="hidden"
            name="clockOut"
            value={toLocalInputValue(punch.clockOut, timezone)}
          />
          <div className="space-y-1">
            <Label htmlFor="fix-clockIn">Clock in ({timezone})</Label>
            <Input
              id="fix-clockIn"
              name="clockIn"
              type="datetime-local"
              required
              defaultValue={toLocalInputValue(punch.clockIn, timezone)}
            />
          </div>
        </>
      ) : null}
      <div className="space-y-1">
        <Label>Reason (required)</Label>
        <Input name="reason" required minLength={1} maxLength={500} />
      </div>
      {error && <p className="text-danger-700 text-sm">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending
          ? "Saving…"
          : ambiguous
            ? onFileRole === "clock-in"
              ? "Save clock-out"
              : "Save clock-in"
            : closeOut
              ? "Close shift"
              : "Save clock-in"}
      </Button>
    </form>
  );
}
