// Shared tab strip for filtering /payroll and /reports by pay-schedule
// kind. Renders as ?schedule=weekly|semi|salaried query param the server
// component reads. "All" clears the filter. Salaried tab on /payroll
// links out to /salaried (where paystub uploads live); on /reports it
// stays in-page and filters to runs against salaried paystub docs.

import Link from "next/link";

export type ScheduleTab = "all" | "weekly" | "semi" | "salaried";

const LABELS: Record<ScheduleTab, string> = {
  all: "All",
  weekly: "Weekly",
  semi: "Semi-monthly",
  salaried: "Salaried",
};

const STYLES: Record<ScheduleTab, { active: string; inactive: string }> = {
  all: {
    active: "bg-text text-white",
    inactive: "text-text-muted hover:text-text",
  },
  weekly: {
    active: "bg-blue-600 text-white",
    inactive: "text-blue-700 hover:bg-blue-50",
  },
  semi: {
    active: "bg-purple-600 text-white",
    inactive: "text-purple-700 hover:bg-purple-50",
  },
  salaried: {
    active: "bg-emerald-600 text-white",
    inactive: "text-emerald-700 hover:bg-emerald-50",
  },
};

export function ScheduleTabs({
  current,
  basePath,
  /** Override per-tab href if a tab routes to a different page (e.g.
   * salaried on /payroll redirects to /salaried). Map tab → href. */
  hrefs,
}: {
  current: ScheduleTab;
  basePath: string;
  hrefs?: Partial<Record<ScheduleTab, string>>;
}) {
  const tabs: ScheduleTab[] = ["all", "weekly", "semi", "salaried"];
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-card border border-border bg-surface-2 p-1 text-xs font-medium">
      {tabs.map((t) => {
        const isActive = current === t;
        const href =
          hrefs?.[t] ??
          (t === "all" ? basePath : `${basePath}?schedule=${t}`);
        const s = STYLES[t];
        return (
          <Link
            key={t}
            href={href}
            className={`rounded-input px-3 py-1.5 transition-colors ${
              isActive ? s.active : s.inactive
            }`}
          >
            {LABELS[t]}
          </Link>
        );
      })}
    </div>
  );
}

export function parseScheduleTab(value: string | undefined): ScheduleTab {
  if (value === "weekly" || value === "semi" || value === "salaried") return value;
  return "all";
}

/**
 * Drizzle WHERE-fragment helper: maps a tab to the schedule.period_kind
 * predicate the server query needs. Returns null when no filter applies.
 */
export function scheduleTabToKind(
  tab: ScheduleTab,
): "WEEKLY" | "SEMI_MONTHLY" | null {
  if (tab === "weekly") return "WEEKLY";
  if (tab === "semi") return "SEMI_MONTHLY";
  return null;
}
