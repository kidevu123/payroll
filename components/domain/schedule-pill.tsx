// Schedule pill — colored chip identifying weekly vs semi-monthly vs
// other pay schedules at a glance. Used everywhere a payroll run /
// period is displayed in a list, so the owner can spot the cadence
// without reading the schedule column.

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

const STYLES: Record<Variant, { bg: string; text: string; ring: string; label: string }> = {
  weekly: {
    // info/warning are flipping semantic tokens; purple/teal have none, so
    // they carry explicit dark: variants. All read correctly on dark now.
    bg: "bg-info-50",
    text: "text-info-700",
    ring: "ring-info-200",
    label: "Weekly",
  },
  semiMonthly: {
    bg: "bg-purple-50 dark:bg-purple-500/15",
    text: "text-purple-700 dark:text-purple-300",
    ring: "ring-purple-200 dark:ring-purple-500/40",
    label: "Semi-monthly",
  },
  biWeekly: {
    bg: "bg-teal-50 dark:bg-teal-500/15",
    text: "text-teal-700 dark:text-teal-300",
    ring: "ring-teal-200 dark:ring-teal-500/40",
    label: "Bi-weekly",
  },
  monthly: {
    bg: "bg-warning-50",
    text: "text-warning-700",
    ring: "ring-warning-200",
    label: "Monthly",
  },
  other: {
    bg: "bg-surface-3",
    text: "text-text-muted",
    ring: "ring-border",
    label: "Unassigned",
  },
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
  const s = STYLES[v];
  // For "other" we show whatever the schedule actually says (e.g. a
  // custom schedule name). For known variants we use the canonical
  // label so tags stay consistent regardless of whether the schedule
  // row is named "Weekly", "weekly", "Weekly Mon-Sun", etc.
  const display = v === "other" ? (name ?? s.label) : s.label;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset whitespace-nowrap",
        s.bg,
        s.text,
        s.ring,
        className,
      )}
    >
      {display}
    </span>
  );
}
