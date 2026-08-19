// Shared tab strip for filtering /payroll and /reports by pay-schedule
// kind. Renders as ?schedule=weekly|semi|salaried query param the server
// component reads. "All" clears the filter. Every tab — including
// Salaried — stays on the same base path; the consuming page renders
// the appropriate UI per tab (salaried tab on /payroll renders
// salaried-employee paystub upload slots inline, no redirect).

import Link from "next/link";
import { cn } from "@/lib/utils";

export type ScheduleTab = "all" | "weekly" | "semi" | "monthly" | "salaried";

const LABELS: Record<ScheduleTab, string> = {
  all: "All",
  weekly: "Weekly",
  semi: "Semi-monthly",
  monthly: "Monthly",
  salaried: "Salaried",
};

// Active palette per tab. Inactive shares one neutral palette so the
// strip reads as a unified segmented control instead of four loose
// links. Each active tint is desaturated (50/100 instead of 600) so
// the chip doesn't shout.
const ACTIVE_TONE: Record<ScheduleTab, string> = {
  // text-surface (not text-white): bg-text is near-white in dark mode, so
  // white text on it was invisible. text-surface inverts cleanly in both
  // themes — dark text on the light pill (dark mode), white text on the dark
  // pill (light mode).
  all: "bg-text text-surface shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.12)]",
  weekly:
    "bg-blue-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.16)]",
  semi:
    "bg-cyan-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.16)]",
  monthly:
    "bg-amber-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.16)]",
  salaried:
    "bg-emerald-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.16)]",
};

export function ScheduleTabs({
  current,
  basePath,
  /** Override per-tab href if a tab routes to a different page. Most
   *  callers pass nothing — every tab stays on basePath with a query
   *  param. Owner ask: don't redirect Salaried out of /payroll —
   *  render salaried-specific UI in place. */
  hrefs,
}: {
  current: ScheduleTab;
  basePath: string;
  hrefs?: Partial<Record<ScheduleTab, string>>;
}) {
  const tabs: ScheduleTab[] = ["all", "weekly", "semi", "monthly", "salaried"];
  return (
    <div className="max-w-full overflow-x-auto pb-1">
      <div
        role="tablist"
        className={cn(
          // Premium segmented control: hairline border, surface-2 trough,
          // single rounded-lg silhouette, every tab gets the same chip
          // shape (active and inactive both rounded-md, just different
          // fills) so the strip reads as ONE control instead of four
          // floating buttons.
          "inline-flex min-w-max items-center gap-0.5 rounded-lg border border-border/70 bg-surface-2/60 p-0.5 text-[12px] font-medium tracking-tight",
          "shadow-[inset_0_1px_2px_0_rgb(15_23_42_/_0.04)]",
        )}
      >
        {tabs.map((t) => {
          const isActive = current === t;
          const href =
            hrefs?.[t] ?? (t === "all" ? basePath : `${basePath}?schedule=${t}`);
          return (
            <Link
              key={t}
              href={href}
              role="tab"
              aria-selected={isActive}
              className={cn(
                "inline-flex h-7 items-center justify-center rounded-md px-3 transition-colors antialiased",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                isActive
                  ? ACTIVE_TONE[t]
                  : "text-text-muted hover:text-text hover:bg-surface-2/40",
              )}
            >
              {LABELS[t]}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function parseScheduleTab(value: string | undefined): ScheduleTab {
  if (
    value === "weekly" ||
    value === "semi" ||
    value === "monthly" ||
    value === "salaried"
  ) return value;
  return "all";
}

/**
 * Drizzle WHERE-fragment helper: maps a tab to the schedule filter the
 * server query needs. WEEKLY/SEMI_MONTHLY/MONTHLY map directly to
 * schedule.period_kind. "salaried" maps to the synthetic "SALARIED"
 * filter — salaried runs have NO period_kind of their own (the enum only
 * covers WEEKLY/BIWEEKLY/SEMI_MONTHLY/MONTHLY), so listReports matches
 * them by schedule name the same way the Reports overview donut does
 * (name lacks week/semi/month, or no schedule attached). Returns null for
 * "all", when no filter applies.
 */
export function scheduleTabToKind(
  tab: ScheduleTab,
): "WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "SALARIED" | null {
  if (tab === "weekly") return "WEEKLY";
  if (tab === "semi") return "SEMI_MONTHLY";
  if (tab === "monthly") return "MONTHLY";
  if (tab === "salaried") return "SALARIED";
  return null;
}
