"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import type { Punch } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PunchRow } from "@/components/domain/punch-row";
import {
  inferAmbiguousOnFileRole,
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
  validateAmbiguousPair,
} from "@/lib/punches/missing-punch";
import { coerceDate } from "@/lib/time/wall-clock";
import {
  createPunchAction,
  editPunchAction,
  voidPunchAction,
} from "../../../actions";

function toLocalInputValue(d: Date | string | null, timezone: string): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(coerceDate(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function formatWallClock(d: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(coerceDate(d));
}

function formatNgtecoSourceLine(notes: string): string {
  const dev = notes.match(/dev:([^\s·]+)/)?.[1];
  const scrape = notes.match(/scrape:([^·]+)/)?.[1];
  const parts = ["From NGTeco time clock"];
  if (dev) parts.push(`device ${dev}`);
  if (scrape) parts.push(`scraped ${scrape.replace(/\|/g, " ")}`);
  return parts.join(" · ");
}

function defaultClockOutGuess(clockIn: Date | string, timezone: string): string {
  const guess = new Date(coerceDate(clockIn).getTime() + 8 * 60 * 60 * 1000);
  return toLocalInputValue(guess, timezone);
}

/** Punch that needs admin attention first (open shift or missing clock-in). */
function findFixTarget(punches: Punch[]): Punch | null {
  const active = punches.filter((p) => !p.voidedAt);
  return (
    active.find((p) => isAmbiguousSinglePunch(p)) ??
    active.find((p) => isOpenShiftPunch(p)) ??
    active.find((p) => isMissingClockInPunch(p)) ??
    null
  );
}

export function PunchEditor({
  periodId,
  employeeId,
  date,
  timezone,
  punches,
  suggestedClockIn,
  suggestedClockOut,
  periodLocked,
  returnTo,
}: {
  periodId: string;
  employeeId: string;
  date: string;
  timezone: string;
  punches: Punch[];
  suggestedClockIn: string;
  suggestedClockOut: string;
  periodLocked: boolean;
  returnTo: string;
}) {
  const fixTarget = findFixTarget(punches);
  const otherPunches = punches.filter((p) => p.id !== fixTarget?.id);
  const [showAddManual, setShowAddManual] = React.useState(
    punches.length === 0,
  );

  return (
    <div className="space-y-4">
      {fixTarget && !periodLocked ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            {isAmbiguousSinglePunch(fixTarget)
              ? "Complete unpaired punch"
              : isOpenShiftPunch(fixTarget)
                ? "Close open shift"
                : "Add missing clock-in"}
          </h2>
          <p className="text-sm text-text-muted">
            {isAmbiguousSinglePunch(fixTarget)
              ? `One punch is on file at ${formatWallClock(fixTarget.clockIn, timezone)}. We are not sure if it was in or out — enter whichever side is missing.`
              : isOpenShiftPunch(fixTarget)
                ? "Clock-in is already on file from the time clock. Enter only the missing clock-out — do not add a new punch below."
                : "Clock-out is on file. Enter only the missing clock-in."}
          </p>
          <FixPunchForm punch={fixTarget} timezone={timezone} />
        </div>
      ) : null}

      {otherPunches.length > 0 || (punches.length > 0 && !fixTarget) ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">
            {fixTarget ? "Other punches this day" : "Existing punches"}
          </h2>
          {otherPunches.length === 0 && !fixTarget ? (
            <p className="text-sm text-text-muted">
              No punches recorded for this day.
            </p>
          ) : (
            (fixTarget ? otherPunches : punches).map((p) => (
              <EditablePunch
                key={p.id}
                punch={p}
                timezone={timezone}
                periodLocked={periodLocked}
              />
            ))
          )}
        </div>
      ) : punches.length === 0 && !fixTarget ? (
        <p className="text-sm text-text-muted">No punches recorded for this day.</p>
      ) : null}

      {!periodLocked && (
        <div className="rounded-card border border-dashed border-border bg-surface p-4">
          {fixTarget && !showAddManual ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowAddManual(true)}
            >
              Add a separate punch (second shift)
            </Button>
          ) : (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">
                {fixTarget ? "Add a separate punch" : "Add manual punch"}
              </h2>
              {fixTarget ? (
                <p className="text-xs text-warning-700 bg-warning-50 border border-warning-200 rounded-input px-2 py-1.5">
                  Use this only for a second in/out pair the same day — not to
                  close the open shift above.
                </p>
              ) : (
                <p className="text-xs text-text-muted">
                  Times are in {timezone}. Source will be MANUAL_ADMIN.
                </p>
              )}
              <CreateForm
                periodId={periodId}
                employeeId={employeeId}
                date={date}
                timezone={timezone}
                suggestedClockIn={suggestedClockIn}
                suggestedClockOut={suggestedClockOut}
                returnTo={returnTo}
              />
            </div>
          )}
        </div>
      )}
      {periodLocked && (
        <p className="text-sm text-text-muted">
          Period is paid. Unmark paid from Payroll to make changes.
        </p>
      )}
    </div>
  );
}

/** Focused fix for open shift, missing clock-in, or ambiguous single punch. */
function FixPunchForm({
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

  const cleanedNotes =
    punch.notes?.replace(/\bambiguous:single\b/g, "").replace(/\s+/g, " ").trim() ??
    "";

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        if (ambiguous) {
          const missing =
            onFileRole === "clock-in"
              ? String(form.get("clockOut") ?? "")
              : String(form.get("clockIn") ?? "");
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
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
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
                <Label htmlFor="fix-clockOut">Missing clock out ({timezone})</Label>
                <Input
                  id="fix-clockOut"
                  name="clockOut"
                  type="datetime-local"
                  required
                />
                <p className="text-xs text-text-muted">
                  The {onFileWallLabel} punch stays as clock-in. Enter a later
                  clock-out time.
                </p>
              </div>
            </>
          ) : (
            <>
              <input type="hidden" name="clockOut" value={onFileTime} />
              <div className="space-y-1">
                <Label htmlFor="fix-clockIn">Missing clock in ({timezone})</Label>
                <Input
                  id="fix-clockIn"
                  name="clockIn"
                  type="datetime-local"
                  required
                />
                <p className="text-xs text-text-muted">
                  The {onFileWallLabel} punch stays as clock-out. Enter an
                  earlier clock-in time (e.g. start of shift).
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
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
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
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
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

function CreateForm({
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

function EditablePunch({
  punch,
  timezone,
  periodLocked,
}: {
  punch: Punch;
  timezone: string;
  periodLocked: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [voidOpen, setVoidOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (punch.voidedAt) {
    return (
      <PunchRow
        punch={punch}
        timezone={timezone}
        rightSlot={<span className="text-xs text-text-muted">voided</span>}
      />
    );
  }

  if (!editing && !voidOpen) {
    return (
      <PunchRow
        punch={punch}
        timezone={timezone}
        rightSlot={
          periodLocked ? null : (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setVoidOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          )
        }
      />
    );
  }

  if (voidOpen) {
    return (
      <form
        action={async (form) => {
          setPending(true);
          setError(null);
          const result = await voidPunchAction(punch.id, form);
          setPending(false);
          if (result?.error) setError(result.error);
          else setVoidOpen(false);
        }}
        className="space-y-2 rounded-card border border-danger-200 bg-danger-50/40 p-3 text-sm"
      >
        <p className="font-medium">Void this punch?</p>
        <Input name="reason" required minLength={1} maxLength={500} placeholder="Reason for void" />
        {error && <p className="text-danger-700">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            Confirm void
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setVoidOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await editPunchAction(punch.id, form);
        setPending(false);
        if (result?.error) setError(result.error);
        else setEditing(false);
      }}
      className="space-y-2 rounded-card border border-border bg-surface-2 p-3 text-sm"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Clock in ({timezone})</Label>
          <Input
            name="clockIn"
            type="datetime-local"
            defaultValue={toLocalInputValue(punch.clockIn, timezone)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>Clock out ({timezone})</Label>
          <Input
            name="clockOut"
            type="datetime-local"
            defaultValue={toLocalInputValue(punch.clockOut, timezone)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Reason (required)</Label>
        <Input name="reason" required minLength={1} maxLength={500} />
      </div>
      <div className="space-y-1">
        <Label>Notes</Label>
        <Input name="notes" maxLength={500} defaultValue={punch.notes ?? ""} />
      </div>
      {error && <p className="text-danger-700">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
