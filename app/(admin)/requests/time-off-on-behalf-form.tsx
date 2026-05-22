"use client";

import * as React from "react";
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTimeOffOnBehalfAction } from "./actions";

type EmployeeOption = { id: string; displayName: string };

/**
 * Owner-side time-off entry. When an employee asks the admin directly for
 * time off (verbal / text / in person), the admin records it here. The
 * row lands as APPROVED + auto-pushes to Google Calendar; the employee
 * gets a notification so they see it appear on their portal.
 */
export function TimeOffOnBehalfForm({
  employees,
}: {
  employees: EmployeeOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus className="h-4 w-4" /> Add time off for employee
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/20"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              setError(null);
              setDone(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-card border border-border bg-surface p-5 space-y-4 shadow-pop">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">
                Add time off for an employee
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setDone(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {done ? (
              <p className="text-xs text-success-700">
                Recorded. Employee notified · pushed to Google Calendar (if
                connected).
              </p>
            ) : (
              <form
                action={async (fd: FormData) => {
                  setPending(true);
                  setError(null);
                  const r = await createTimeOffOnBehalfAction(fd);
                  setPending(false);
                  if (r?.error) {
                    setError(r.error);
                    return;
                  }
                  setDone(true);
                  setTimeout(() => {
                    setOpen(false);
                    setDone(false);
                  }, 1500);
                }}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs">
                    <span className="text-text-muted">Employee</span>
                    <select
                      name="employeeId"
                      required
                      className="w-full rounded-input border border-border/70 bg-surface px-3 h-10 text-sm"
                      defaultValue=""
                    >
                      <option value="" disabled>Choose…</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-text-muted">Type</span>
                    <select
                      name="type"
                      required
                      defaultValue="UNPAID"
                      className="w-full rounded-input border border-border/70 bg-surface px-3 h-10 text-sm"
                    >
                      <option value="UNPAID">Unpaid</option>
                      <option value="SICK">Sick</option>
                      <option value="PERSONAL">Personal</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-text-muted">Start date</span>
                    <input
                      type="date"
                      name="startDate"
                      required
                      className="w-full rounded-input border border-border/70 bg-surface px-3 h-10 text-sm"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-text-muted">End date</span>
                    <input
                      type="date"
                      name="endDate"
                      required
                      className="w-full rounded-input border border-border/70 bg-surface px-3 h-10 text-sm"
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="text-text-muted">Reason (optional)</span>
                  <textarea
                    name="reason"
                    maxLength={500}
                    rows={2}
                    placeholder="e.g. Out for daughter's graduation"
                    className="w-full rounded-input border border-border/70 bg-surface px-3 py-2 text-sm"
                  />
                </label>
                {error && <p className="text-xs text-danger-700">{error}</p>}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-text-muted">
                    Saved as APPROVED · employee notified · suppresses
                    missed-punch alerts on those days.
                  </p>
                  <Button type="submit" size="sm" disabled={pending} className="shrink-0">
                    {pending ? "Saving…" : "Record time off"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
