"use client";

import * as React from "react";
import Link from "next/link";
import type { Employee, PaySchedule, Shift } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createEmployeeAction, updateEmployeeAction } from "./actions";

type EmployeePrefill = {
  displayName?: string;
  legalName?: string;
  ngtecoEmployeeRef?: string;
};

type Props =
  | {
      mode: "create";
      shifts: Shift[];
      schedules: PaySchedule[];
      employee?: undefined;
      /** Optional prefill from query string (e.g. CSV upload "Add as new"). */
      prefill?: EmployeePrefill;
    }
  | {
      mode: "edit";
      shifts: Shift[];
      schedules: PaySchedule[];
      employee: Employee;
      prefill?: undefined;
    };

export function EmployeeForm(props: Props) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    const result =
      props.mode === "create"
        ? await createEmployeeAction(form)
        : await updateEmployeeAction(props.employee.id, form);
    setPending(false);
    if (result?.error) setError(result.error);
  }

  const e = props.mode === "edit" ? props.employee : undefined;
  const prefill = props.mode === "create" ? props.prefill ?? {} : {};

  // Look up Weekly + Semi-Monthly schedule IDs from the active list. The
  // classification UI maps to (payType, payScheduleId) under the hood.
  const weeklySchedule = props.schedules.find(
    (s) => s.periodKind === "WEEKLY" && s.active,
  );
  const semiSchedule = props.schedules.find(
    (s) => s.periodKind === "SEMI_MONTHLY" && s.active,
  );

  // Derive the existing employee's classification from their stored
  // payType / payScheduleId so edits open with the right radio selected.
  const initialClassification: "WEEKLY_HOURLY" | "SEMI_HOURLY" | "SALARIED" = (() => {
    if (e?.payType === "SALARIED") return "SALARIED";
    if (e?.payScheduleId === semiSchedule?.id) return "SEMI_HOURLY";
    return "WEEKLY_HOURLY"; // safe default for HOURLY without a schedule
  })();
  const [classification, setClassification] = React.useState<
    "WEEKLY_HOURLY" | "SEMI_HOURLY" | "SALARIED"
  >(initialClassification);

  // Hidden values submitted to the server actions (which still take
  // payType + payScheduleId so we don't have to rev the schema).
  const submittedPayType =
    classification === "SALARIED" ? "SALARIED" : "HOURLY";
  const submittedPayScheduleId =
    classification === "WEEKLY_HOURLY"
      ? weeklySchedule?.id ?? ""
      : classification === "SEMI_HOURLY"
        ? semiSchedule?.id ?? ""
        : // Salaried — irrelevant to payroll runs, leave assigned to whatever
          // the employee already had so we don't unnecessarily null it out.
          e?.payScheduleId ?? "";

  return (
    <form
      action={onSubmit}
      className="space-y-4 rounded-card border border-border bg-surface p-5"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            name="displayName"
            defaultValue={e?.displayName ?? prefill.displayName ?? ""}
            required
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="legalName">Legal name (if different)</Label>
          <Input
            id="legalName"
            name="legalName"
            defaultValue={e?.legalName ?? ""}
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={e?.email ?? ""}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={e?.phone ?? ""}
            placeholder="+15551234567"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ngtecoEmployeeRef">
            NGTeco / CSV employee ref
          </Label>
          <Input
            id="ngtecoEmployeeRef"
            name="ngtecoEmployeeRef"
            defaultValue={e?.ngtecoEmployeeRef ?? prefill.ngtecoEmployeeRef ?? ""}
            placeholder="e.g. 9 (matches the Person ID column in the NGTeco CSV)"
            maxLength={64}
          />
          <p className="text-xs text-text-muted">
            Binds this employee to a row in the NGTeco / punch-CSV exports.
            Without it, CSV uploads show this person as &ldquo;No
            match&rdquo; on preview.
          </p>
        </div>
        {props.mode === "create" && (
          <div className="space-y-1">
            <Label htmlFor="hiredOn">Hired on</Label>
            <Input
              id="hiredOn"
              name="hiredOn"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="shiftId">Shift</Label>
          <select
            id="shiftId"
            name="shiftId"
            defaultValue={e?.shiftId ?? ""}
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            <option value="">Unassigned</option>
            {props.shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="classification">Classification</Label>
          <select
            id="classification"
            value={classification}
            onChange={(ev) =>
              setClassification(
                ev.target.value as
                  | "WEEKLY_HOURLY"
                  | "SEMI_HOURLY"
                  | "SALARIED",
              )
            }
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            <option value="WEEKLY_HOURLY">
              Weekly hourly (punches → weekly payroll)
            </option>
            <option value="SEMI_HOURLY">
              Semi-monthly hourly (punches accumulate; only run on the
              semi-monthly cycle, excluded from weekly payroll)
            </option>
            <option value="SALARIED">
              Salaried (W2 only — no punches, paystub uploaded by admin)
            </option>
          </select>
          <p className="text-xs text-text-muted">
            {classification === "WEEKLY_HOURLY" &&
              "Punches roll up into the weekly payroll run."}
            {classification === "SEMI_HOURLY" &&
              "Punches keep accumulating; processed on the semi-monthly cycle. Completely excluded from weekly payroll."}
            {classification === "SALARIED" &&
              "No punches. Upload W2 / paystub from the Salaried tab; appears on the employee's Pay tab."}
          </p>
          {/* Hidden fields — server actions still consume payType + payScheduleId. */}
          <input type="hidden" name="payType" value={submittedPayType} />
          <input
            type="hidden"
            name="payScheduleId"
            value={submittedPayScheduleId}
          />
        </div>
        {props.mode === "create" && (
          <div className="space-y-1">
            <Label htmlFor="initialHourlyRateDollars">Initial hourly rate ($)</Label>
            <Input
              id="initialHourlyRateDollars"
              name="initialHourlyRateDollars"
              type="number"
              min={0}
              step={0.01}
              placeholder="20.00"
            />
            <p className="text-xs text-text-muted">
              Type the dollar amount, e.g. 20 or 20.50.
            </p>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="language">Language</Label>
          <select
            id="language"
            name="language"
            defaultValue={e?.language ?? "en"}
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={e?.notes ?? ""}
          rows={3}
          maxLength={2000}
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      {classification === "SALARIED" ? (
        // Salaried implies W2 upload — no checkbox needed. Hidden field
        // ensures the action receives "1" so the period detail's W2 slot
        // appears unconditionally for salaried staff.
        <div className="rounded-card border border-purple-200 bg-purple-50/40 p-3 text-sm">
          <span className="font-medium text-purple-900">
            W2 / paystub upload is enabled
          </span>
          <span className="block text-xs text-purple-800">
            Salaried staff are paid externally. Upload their W2 or paystub
            from the Salaried tab; the employee sees it on their Pay tab.
          </span>
          <input type="hidden" name="requiresW2Upload" value="1" />
        </div>
      ) : classification === "SEMI_HOURLY" ? (
        <div className="rounded-card border border-border bg-surface-2/50 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="requiresW2Upload"
              value="1"
              defaultChecked={e?.requiresW2Upload ?? false}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">
                Also upload an external paystub each period
              </span>
              <span className="block text-xs text-text-muted">
                Tick this when the accountant prepares Juan-style W2-formatted
                paystubs alongside his hourly run. The period detail page will
                show an upload slot for him.
              </span>
            </span>
          </label>
        </div>
      ) : (
        // Weekly hourly — payslip is computed from punches; no W2 needed.
        // Submit a hidden "0" so legacy data flips off if it was on.
        <input type="hidden" name="requiresW2Upload" value="0" />
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="ghost" type="button">
          <Link href={e ? `/employees/${e.id}` : "/employees"}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

