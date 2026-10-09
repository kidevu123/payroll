// Vertical timeline of rate changes. Newest first.

import * as React from "react";
import { cn } from "@/lib/utils";
import type { EmployeeRateHistoryRow } from "@/lib/db/schema";
import { formatIsoDate } from "@/lib/employees/profile-summary";
import { MoneyDisplay } from "./money-display";

export function RateHistoryList({
  rates,
  className,
}: {
  rates: EmployeeRateHistoryRow[];
  className?: string;
}) {
  if (rates.length === 0) {
    return (
      <p className={cn("text-sm text-text-muted", className)}>
        No rate history yet.
      </p>
    );
  }
  return (
    <ol
      className={cn(
        "relative space-y-3 border-l border-border pl-5",
        className,
      )}
    >
      {rates.map((r, i) => (
        <li key={r.id} className="relative">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full",
              i === 0 ? "bg-brand-700" : "bg-border",
            )}
          />
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium tabular-nums">
              <MoneyDisplay cents={r.hourlyRateCents} monospace={false} />/hr
            </span>
            <span className="shrink-0 text-text-muted">
              {formatIsoDate(r.effectiveFrom)}
            </span>
          </div>
          {r.reason ? (
            <p className="mt-0.5 text-xs text-text-muted">{r.reason}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
