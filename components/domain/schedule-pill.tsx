// Schedule pill — quiet neutral chip naming the pay cadence. Calm pass
// (owner direction Jul 2026): cadence is context, not state, so it no
// longer carries color — the status chip is the one colored element per
// row. The canonical-label normalization stays so "Weekly Mon-Sun" and
// "weekly" both render as "Weekly".

import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "weekly" | "semiMonthly" | "biWeekly" | "monthly" | "other";

function variantOf(name: string | null | undefined): Variant {
  if (!name) return "other";
  const n = name.toLowerCase();
  if (n.includes("semi")) return "semiMonthly";
  if (n.includes("bi") || n.includes("two-week")) return "biWeekly";
  if (n.includes("month") && !n.includes("semi")) return "monthly";
  if (n.includes("week")) return "weekly";
  return "other";
}

const LABELS: Record<Variant, string> = {
  weekly: "Weekly",
  semiMonthly: "Semi-monthly",
  biWeekly: "Bi-weekly",
  monthly: "Monthly",
  other: "Unassigned",
};

export function SchedulePill({
  name,
  className,
}: {
  /** Schedule name from pay_schedules.name. NULL = "unassigned". */
  name: string | null | undefined;
  className?: string;
}) {
  const v = variantOf(name);
  // For "other" we show whatever the schedule actually says (e.g. a
  // custom schedule name or "Salaried"). For known variants we use the
  // canonical label so tags stay consistent.
  const display = v === "other" ? (name ?? LABELS[v]) : LABELS[v];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip border border-border/70 bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted whitespace-nowrap",
        className,
      )}
    >
      {display}
    </span>
  );
}
