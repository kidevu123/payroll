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
  /** Period gross (rounded) in cents. Used to default the CASH
   *  withdrawal amount when the operator picks "paid in cash". */
  periodGrossRoundedCents = 0,
}: {
  period: PayPeriod;
  incompletePunchCount?: number;
  periodGrossRoundedCents?: number;
}) {
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [unmarkOpen, setUnmarkOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [paymentMethod, setPaymentMethod] = React.useState<"BANK" | "CASH">("BANK");
  const [cashDollars, setCashDollars] = React.useState(
    () => (periodGrossRoundedCents / 100).toFixed(2),
  );

  if (period.state === "PAID") {
    // Compact action — sits inline with PublishPortalButton in the
    // header bar at consistent size="sm". The unmark confirm popover
    // expands below the row instead of replacing it (the previous
    // amber card blew out the bar's height and shoved everything
    // around).
    return (
      <div className="relative flex flex-col items-end gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setUnmarkOpen((v) => !v)}
        >
          <RotateCcw className="h-4 w-4" /> Unmark paid
        </Button>
        {unmarkOpen && (
          <form
            action={async (form) => {
              setPending(true);
              setError(null);
              const result = await unmarkPaidAction(period.id, form);
              setPending(false);
              if (result?.error) setError(result.error);
              else setUnmarkOpen(false);
            }}
            className="absolute right-0 top-full z-30 mt-2 w-72 rounded-card border border-warn-200 bg-surface p-2.5 shadow-pop space-y-2"
          >
            <p className="text-[11px] text-text-muted leading-snug">
              Unmark paid for {period.startDate}? If the period was paid from
              the cash drawer, the withdrawal is reversed automatically.
            </p>
            <Input
              name="reason"
              required
              minLength={1}
              maxLength={500}
              placeholder="Reason (audited)"
              className="h-8 text-xs"
            />
            {error && <p className="text-[11px] text-danger-700">{error}</p>}
            <div className="flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setUnmarkOpen(false)}
              >
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </form>
        )}
      </div>
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
          size="sm"
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
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <form
          action={async () => {
            setPending(true);
            setError(null);
            const fd = new FormData();
            fd.set("paymentMethod", paymentMethod);
            if (paymentMethod === "CASH") {
              const cents = Math.round(Number(cashDollars) * 100);
              if (!Number.isFinite(cents) || cents <= 0) {
                setPending(false);
                setError("Enter a positive cash amount.");
                return;
              }
              fd.set("cashAmountCents", cents.toString());
            }
            const result = await markPaidAction(period.id, fd);
            setPending(false);
            if (result?.error) setError(result.error);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted whitespace-nowrap">Payment</span>
            <select
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(e.target.value as "BANK" | "CASH")
              }
              disabled={pending}
              className="h-8 rounded-input border border-border/70 bg-surface px-2.5 text-xs"
            >
              <option value="BANK">Paid through bank</option>
              <option value="CASH">Paid through cash</option>
            </select>
          </div>
          {paymentMethod === "CASH" && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted whitespace-nowrap">Cash ($)</span>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={cashDollars}
                onChange={(e) => setCashDollars(e.target.value)}
                disabled={pending}
                className="h-8 w-24 text-xs"
              />
            </div>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={pending}
            title="Only mark paid once payment has actually been sent."
          >
            <CheckCircle2 className="h-4 w-4" />{" "}
            {pending ? "Marking…" : "Mark as paid"}
          </Button>
        </form>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setUnlockOpen((v) => !v)}
          title="Unlock to correct punches before payment."
        >
          <Unlock className="h-4 w-4" /> Unlock
        </Button>
      </div>
      {error && <p className="text-xs text-danger-700">{error}</p>}

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
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-card border border-warn-200 bg-surface p-2.5 shadow-pop space-y-2"
        >
          <p className="text-[11px] text-text-muted leading-snug">
            Unlock {period.startDate}? Reason will be audited.
          </p>
          <Input
            name="reason"
            required
            minLength={1}
            maxLength={500}
            placeholder="Correction reason"
            className="h-8 text-xs"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => setUnlockOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Unlocking…" : "Confirm unlock"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
