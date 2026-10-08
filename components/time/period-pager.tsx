// Period range with prev / next / Today. On touch it is one full-width
// segmented control with 44px targets; on desktop it collapses to a quiet
// inline pager.
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ScheduleTab } from "@/components/domain/schedule-tabs";
import { formatPeriodRange } from "@/lib/payroll/format-period";
import type { PeriodView } from "@/lib/time-grid/period-select";

export function PeriodPager({
  period,
  lastDay,
  adjacent,
  tab,
}: {
  period: PeriodView;
  lastDay: string;
  adjacent: { prevId: string | null; nextId: string | null };
  tab: ScheduleTab;
}) {
  return (
    <div className="flex items-center gap-1 max-lg:rounded-input max-lg:border max-lg:border-border max-lg:bg-surface max-lg:p-0.5 max-lg:shadow-card">
      {adjacent.prevId ? (
        <Link
          href={`/time?${new URLSearchParams({ ...(tab !== "all" ? { schedule: tab } : {}), period: adjacent.prevId })}`}
          className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center rounded-input lg:rounded hover:bg-surface-2/40 active:bg-surface-2/60 text-text-muted hover:text-text transition-colors"
          aria-label="Previous period"
        >
          <ChevronLeft className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
        </Link>
      ) : (
        <span className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center text-text-subtle/20">
          <ChevronLeft className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-center text-body font-medium tabular-nums text-text lg:flex-none lg:px-0.5 lg:text-left lg:text-text-muted">
        {formatPeriodRange(period.startDate, lastDay)}
        {period.state === "UPCOMING" && (
          <span className="ml-2.5 hidden text-micro uppercase text-brand-600 lg:inline">
            live · punches will land here
          </span>
        )}
      </span>
      {adjacent.nextId ? (
        <Link
          href={`/time?${new URLSearchParams({ ...(tab !== "all" ? { schedule: tab } : {}), period: adjacent.nextId })}`}
          className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center rounded-input lg:rounded hover:bg-surface-2/40 active:bg-surface-2/60 text-text-muted hover:text-text transition-colors"
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
        </Link>
      ) : (
        <span className="h-11 w-11 lg:h-8 lg:w-8 shrink-0 inline-flex items-center justify-center text-text-subtle/20">
          <ChevronRight className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
        </span>
      )}
      {/* Jump straight back to the current period (drops ?period= so the
          page auto-selects today's period for this schedule). */}
      <Link
        href={`/time${tab !== "all" ? `?schedule=${tab}` : ""}`}
        className="h-11 lg:h-6 shrink-0 inline-flex items-center rounded-input lg:rounded px-3 lg:px-2 lg:ml-1 text-micro uppercase text-text-muted hover:bg-surface-2/40 active:bg-surface-2/60 hover:text-text transition-colors max-lg:border-l max-lg:border-border/70 max-lg:rounded-l-none"
      >
        Today
      </Link>
    </div>
  );
}
