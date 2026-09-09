// Shared tab strip for filtering /payroll and /time by pay-schedule
// kind. Underline tabs, the same treatment as the Reports page's tabs. Renders as ?schedule=weekly|semi|salaried query param the server
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
    <div className="max-w-full overflow-x-auto">
      <div role="tablist" className="flex min-w-max gap-6 border-b border-border/70">
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
                "-mb-px border-b-2 px-1 pb-2.5 pt-1 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                isActive
                  ? "border-brand-700 text-brand-700"
                  : "border-transparent text-text-muted hover:text-text",
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
