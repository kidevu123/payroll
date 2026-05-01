"use client";

import * as React from "react";
import { Lock, Unlock } from "lucide-react";
import type { PayPeriod } from "@/lib/db/schema";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { lockPeriodAction, unlockPeriodAction } from "../actions";

export function LockButtons({ period }: { period: PayPeriod }) {
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (period.state === "PAID") {
    return (
      <p className="text-sm text-text-muted">
        Period is paid. Pay records are immutable.
      </p>
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

  // LOCKED
  if (!unlockOpen) {
    return (
      <Button variant="secondary" onClick={() => setUnlockOpen(true)}>
        <Unlock className="h-4 w-4" /> Unlock period
      </Button>
    );
  }

  return (
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
      <p className="text-sm font-medium">Unlock {period.startDate}? Reason will be audited.</p>
      <Input name="reason" required minLength={1} maxLength={500} placeholder="Correction reason" />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Unlocking…" : "Confirm unlock"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setUnlockOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
