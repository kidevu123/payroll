// Per-alert card for the employee Home tab. Tap navigates to the
// missed-punch fix form.

import * as React from "react";
import Link from "next/link";
import { ExceptionBadge } from "@/components/domain/exception-badge";

export function AlertCard({
  alertId,
  date,
  issue,
}: {
  alertId: string;
  date: string;
  issue: "MISSING_IN" | "MISSING_OUT" | "NO_PUNCH" | "SUSPICIOUS_DURATION";
}) {
  return (
    <Link
      href={`/me/home/missed-punch/${alertId}`}
      className="rounded-[--radius-card] border border-[--border] bg-[--surface] p-3 flex items-center justify-between gap-3 hover:bg-[--surface-2]"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{date}</div>
        <div className="mt-1">
          <ExceptionBadge issue={issue} />
        </div>
      </div>
      <span className="text-xs text-[--color-brand-700]">Fix this</span>
    </Link>
  );
}
