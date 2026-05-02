"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addManualPunchAction } from "../actions";

type EmployeeLite = {
  id: string;
  displayName: string;
  payType: "HOURLY" | "FLAT_TASK" | "SALARIED";
};

export function ManualPunchForm({
  employees,
  timezone,
}: {
  employees: EmployeeLite[];
  timezone: string;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  // Default the date + times to "now" in company tz so the form isn't
  // empty. Admins almost always edit a recent or current punch.
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  const defaultIn = `${today}T08:00`;
  const defaultOut = `${today}T17:00`;

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        // The datetime-local input gives us "YYYY-MM-DDTHH:mm" with no tz
        // info. The server's createPunch expects a Date; constructing
        // `new Date("2026-04-30T08:00")` parses as the host TZ which on
        // the server is UTC. We need it to be company-tz. The cleanest
        // fix is to interpret the wall-clock as the company timezone and
        // emit an ISO string with the right offset before submit.
        const wallIn = String(form.get("clockIn") ?? "");
        const wallOut = String(form.get("clockOut") ?? "");
        if (wallIn) form.set("clockIn", wallToIsoInTz(wallIn, timezone));
        if (wallOut) form.set("clockOut", wallToIsoInTz(wallOut, timezone));
        // Date field is the calendar day from the wall clock-in.
        if (wallIn) form.set("date", wallIn.slice(0, 10));
        const result = await addManualPunchAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-4 rounded-card border border-border bg-surface p-5"
    >
      <div className="space-y-1">
        <Label htmlFor="employeeId">Employee</Label>
        <select
          id="employeeId"
          name="employeeId"
          required
          className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          defaultValue=""
        >
          <option value="" disabled>
            Choose an employee…
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.displayName}
              {e.payType === "SALARIED" ? " (salaried)" : ""}
              {e.payType === "FLAT_TASK" ? " (flat / task)" : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted">
          Salaried employees don&apos;t get hourly payslips, so adding
          punches for them won&apos;t affect their pay — only the
          attendance record.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="clockIn">Clock in</Label>
          <Input
            id="clockIn"
            name="clockIn"
            type="datetime-local"
            defaultValue={defaultIn}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="clockOut">Clock out</Label>
          <Input
            id="clockOut"
            name="clockOut"
            type="datetime-local"
            defaultValue={defaultOut}
          />
          <p className="text-xs text-text-muted">
            Leave blank for an open punch (still actively working).
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input id="notes" name="notes" maxLength={500} />
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded-input bg-red-50 px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save punch"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Convert a "YYYY-MM-DDTHH:mm" wall-clock string interpreted in the
 * given IANA tz to an absolute UTC ISO string. Browsers parse
 * datetime-local without tz info, so we have to do this ourselves so
 * the server insert lands at the correct UTC instant.
 */
function wallToIsoInTz(wall: string, tz: string): string {
  // Parse the components naively.
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return wall; // bad input — let the server reject it.
  const [, y, mo, d, hh, mm] = m;
  const guess = new Date(Date.UTC(
    Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm),
  ));
  // Find the offset between the same wall-clock interpreted as UTC vs
  // the same wall-clock interpreted as `tz`. Subtract that offset to
  // shift the guess to the real instant.
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const get = (t: string) => Number(tzParts.find((p) => p.type === t)?.value);
  const tzAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = tzAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}
