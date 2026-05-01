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

export function LockButtons({ period }: { period: PayPeriod }) {
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
          setPending(true);
          await lockPeriodAction(period.id);
          setPending(false);
        }}
      >
        <Button type="submit" disabled={pending}>
          <Lock className="h-4 w-4" /> {pending ? "Locking…" : "Lock period"}
        </Button>
        <p className="mt-2 text-xs text-text-muted">
          Locking marks the period ready for review. You can unlock with a
          reason if you need to make corrections.
        </p>
      </form>
    );
  }

  // LOCKED — admin can mark paid (to record actual payment) or unlock to fix.
  return (
    <div className="space-y-3">
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
          <Button type="submit" disabled={pending}>
            <CheckCircle2 className="h-4 w-4" />{" "}
            {pending ? "Marking…" : "Mark as paid"}
          </Button>
        </form>
        {!unlockOpen && (
          <Button variant="secondary" onClick={() => setUnlockOpen(true)}>
            <Unlock className="h-4 w-4" /> Unlock
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-text-muted">
        Only mark paid once payment has actually been sent. Unlocking lets
        you correct punches before payment.
      </p>

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
