"use client";

// Client confirm controls for the "Confirm your hours" hero.
//
// One tap calls the EXISTING acknowledge server action
// (acknowledgePayslipAction in app/(employee)/me/pay/[periodId]/actions.ts).
// We do NOT reinvent acknowledgement logic here — this is purely the tap
// surface + calm confirmed state. The secondary "Something's off" link
// routes to the payslip detail page where the existing Report-a-problem
// dispute flow lives.

import * as React from "react";
import Link from "next/link";
import { CircleCheck, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acknowledgePayslipAction } from "@/app/(employee)/me/pay/[periodId]/actions";

type ConfirmCopy = {
  confirm: string;
  confirming: string;
  somethingOff: string;
  confirmed: string;
};

export function ConfirmHoursActions({
  payslipId,
  disputeHref,
  copy,
}: {
  payslipId: string;
  disputeHref: string;
  copy: ConfirmCopy;
}) {
  const [pending, setPending] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 rounded-input border border-success-200/80 bg-success-50 px-4 py-3 text-sm font-medium text-success-700">
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden />
        <span>{copy.confirmed}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <form
        action={async () => {
          setPending(true);
          setError(null);
          const result = await acknowledgePayslipAction(payslipId);
          setPending(false);
          if (result?.error) {
            setError(result.error);
            return;
          }
          setConfirmed(true);
        }}
      >
        {/* Big primary tap target — full-width, lg size, mobile-first. */}
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          <CircleCheck className="h-5 w-5" aria-hidden />
          {pending ? copy.confirming : copy.confirm}
        </Button>
      </form>

      <Button asChild variant="ghost" size="sm" className="w-full text-text-muted">
        <Link href={disputeHref}>
          <CircleAlert className="h-4 w-4" aria-hidden />
          {copy.somethingOff}
        </Link>
      </Button>

      {error && (
        <p className="text-center text-xs text-danger-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
