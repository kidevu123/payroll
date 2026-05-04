"use client";

import * as React from "react";
import { CheckCircle2, Lock, RotateCcw, Unlock } from "lucide-react";
import type { PayPeriod } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  lockPeriodAction,
  markPaidAction,
  unlockPeriodAction,
  unmarkPaidAction,
} from "../actions";

export function LockButtons({
  period,
  /** Number of incomplete punches across all employees in this period.
   *  When > 0, the Lock button gates with a confirm dialog so the admin
   *  has a chance to fix missing clock-outs before the period freezes. */
  incompletePunchCount = 0,
}: {
  period: PayPeriod;
  incompletePunchCount?: number;
}) {
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [unmarkOpen, setUnmarkOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (period.state === "PAID") {
    if (!unmarkOpen) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            Period is marked paid. Pay records are immutable while in this
            state.
          </p>
          <Button variant="secondary" onClick={() => setUnmarkOpen(true)}>
            <RotateCcw className="h-4 w-4" /> Unmark paid
          </Button>
          <p className="text-xs text-text-muted">
            Use this if the period was marked paid by mistake (e.g. a legacy
            import) or you need to make corrections.
          </p>
        </div>
      );
    }
    return (
      <form
        action={async (form) => {
          setPending(true);
          setError(null);
          const result = await unmarkPaidAction(period.id, form);
          setPending(false);
          if (result?.error) setError(result.error);
          else setUnmarkOpen(false);
        }}
        className="space-y-2 rounded-card border border-amber-200 bg-amber-50/40 p-4"
      >
        <p className="text-sm font-medium">
          Unmark paid for {period.startDate}? Reason will be audited.
        </p>
        <Input
          name="reason"
          required
          minLength={1}
          maxLength={500}
          placeholder="Reason (e.g. legacy import was test data)"
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Confirm unmark"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setUnmarkOpen(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (period.state === "OPEN") {
    return (
      <form
        action={async () => {
          if (incompletePunchCount > 0) {
            const ok = window.confirm(
              `${incompletePunchCount} incomplete punch${incompletePunchCount === 1 ? "" : "es"} in this period (employee clocked in but never clocked out). These contribute $0 to the payslips and stay broken if you lock.\n\nLock anyway?\n\nClick Cancel to fix the punches first — open each flagged employee row in the table to add the missing clock-out.`,
            );
            if (!ok) return;
          }
          setPending(true);
          await lockPeriodAction(period.id);
          setPending(false);
        }}
      >
        <Button
          type="submit"
          disabled={pending}
          title={
            incompletePunchCount > 0
              ? `${incompletePunchCount} incomplete punches — fix them first or you'll lock with $0 hours for those shifts.`
              : "Mark this period ready for review. You can unlock with a reason if you need to make corrections."
          }
        >
          <Lock className="h-4 w-4" /> {pending ? "Locking…" : "Lock period"}
          {incompletePunchCount > 0 && (
            <span className="ml-1 rounded-input bg-amber-500 px-1.5 py-0 text-[10px] font-bold text-white">
              {incompletePunchCount}
            </span>
          )}
        </Button>
      </form>
    );
  }

  // LOCKED — admin can mark paid (to record actual payment) or unlock to fix.
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <form
          action={async () => {
            setPending(true);
            setError(null);
            const result = await markPaidAction(period.id);
            setPending(false);
            if (result?.error) setError(result.error);
          }}
        >
          <Button
            type="submit"
            disabled={pending}
            title="Only mark paid once payment has actually been sent."
          >
            <CheckCircle2 className="h-4 w-4" />{" "}
            {pending ? "Marking…" : "Mark as paid"}
          </Button>
        </form>
        {!unlockOpen && (
          <Button
            variant="secondary"
            onClick={() => setUnlockOpen(true)}
            title="Unlock to correct punches before payment."
          >
            <Unlock className="h-4 w-4" /> Unlock
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}

      {unlockOpen && (
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            const result = await unlockPeriodAction(period.id, form);
            setPending(false);
            if (result?.error) setError(result.error);
            else setUnlockOpen(false);
          }}
          className="space-y-2 rounded-card border border-amber-200 bg-amber-50/40 p-4"
        >
          <p className="text-sm font-medium">
            Unlock {period.startDate}? Reason will be audited.
          </p>
          <Input
            name="reason"
            required
            minLength={1}
            maxLength={500}
            placeholder="Correction reason"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Unlocking…" : "Confirm unlock"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setUnlockOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
