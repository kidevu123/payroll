"use client";

import * as React from "react";
import Link from "next/link";
import type { Employee, Shift } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createEmployeeAction, updateEmployeeAction } from "./actions";

type Props =
  | { mode: "create"; shifts: Shift[]; employee?: undefined }
  | { mode: "edit"; shifts: Shift[]; employee: Employee };

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
            defaultValue={e?.displayName ?? ""}
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
        <div className="space-y-1">
          <Label htmlFor="payType">Pay type</Label>
          <select
            id="payType"
            name="payType"
            defaultValue={e?.payType ?? "HOURLY"}
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            <option value="HOURLY">Hourly</option>
            <option value="FLAT_TASK">Flat / task</option>
          </select>
        </div>
        {props.mode === "create" && (
          <div className="space-y-1">
            <Label htmlFor="initialHourlyRateCents">Initial hourly rate (cents)</Label>
            <Input
              id="initialHourlyRateCents"
              name="initialHourlyRateCents"
              type="number"
              min={0}
              step={1}
              placeholder="2000 = $20.00/hr"
            />
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

