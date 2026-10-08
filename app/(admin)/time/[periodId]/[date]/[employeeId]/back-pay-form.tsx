"use client";

// Add a back-pay shift on a day whose period is already paid.
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createBackPayPunchAction } from "../../../actions";

/**
 * Back pay entry for a day inside an already-PAID period. Records the
 * shift with its true timestamps but pays it in the current open period
 * (server action resolves the target period). Shown in place of the
 * normal add/edit forms when the period is locked.
 */
export function BackPayForm({
  employeeId,
  date,
  timezone,
  suggestedClockIn,
  suggestedClockOut,
  returnTo,
}: {
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
        form.set("employeeId", employeeId);
        form.set("workDate", date);
        form.set("returnTo", returnTo);
        const result = await createBackPayPunchAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-3 rounded-card border-2 border-warning-200 bg-warning-50 p-4"
    >
      <h2 className="text-base font-semibold">Add back pay for {date}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="backpay-clockIn">Clock in ({timezone})</Label>
          <Input
            id="backpay-clockIn"
            name="clockIn"
            type="datetime-local"
            defaultValue={suggestedClockIn}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="backpay-clockOut">Clock out ({timezone})</Label>
          <Input
            id="backpay-clockOut"
            name="clockOut"
            type="datetime-local"
            defaultValue={suggestedClockOut}
            required
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="backpay-reason">Reason (required)</Label>
        <Input
          id="backpay-reason"
          name="reason"
          required
          minLength={1}
          maxLength={500}
          placeholder="Reported after the week was paid"
        />
      </div>
      <p className="text-xs text-text-muted">
        The punch stays dated {date} on payslips and reports, and the pay
        is added to the employee&apos;s current open period.
      </p>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add back pay"}
        </Button>
      </div>
    </form>
  );
}
