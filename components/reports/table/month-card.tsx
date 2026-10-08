"use client";

// One month band of the ledger: collapsible header with month totals, then
// its period lines.
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";

import { TABLE_GRID, type SharedHandlers } from "@/components/reports/table/shared";
import { PeriodLine } from "@/components/reports/table/period-line";
import {
  periodNet,
  periodGross,
  monthNet,
  monthGross,
  type MonthGroup,
} from "@/lib/reports/table-model";

export function MonthCard({
  month,
  collapsed,
  onToggle,
  ...handlers
}: { month: MonthGroup; collapsed: boolean; onToggle: () => void } & SharedHandlers) {
  const net = monthNet(month);
  const gross = monthGross(month);
  // W2 paystub periods have no gross figure (paystubs carry net only), so a
  // month containing them under-reports Total gross — flag it rather than
  // let gross read as smaller than net without explanation.
  const grossIncomplete = month.periods.some(
    (p) => periodGross(p) === 0 && periodNet(p) > 0,
  );
  const runCount = month.periods.reduce((n, p) => n + p.runs.length, 0);
  const employees = month.periods.reduce((n, p) => n + (p.employeesPaid ?? 0), 0);

  return (
    <section aria-label={month.label} className="border-b border-border/60 last:border-b-0">
      {/* Month header. On lg it rides TABLE_GRID so the Total gross / Total
          net figures sit directly above the Gross pay / Net pay columns they
          total — previously this was a `flex justify-between` cluster pinned
          to the card's right edge, i.e. floating over the actions column and
          aligned with nothing. Below lg it falls back to the flex layout. */}
      {/* Month band: name + count on the left, the month's gross and net
          directly over the columns they total (TABLE_GRID via lg:contents). */}
      <header
        className={cn(
          "flex items-center justify-between gap-3 border-b border-border/60 bg-surface-2/50 px-4 py-2 sm:px-5",
          "lg:grid lg:items-center lg:gap-3",
          TABLE_GRID,
        )}
      >
        <div className="flex min-w-0 items-center gap-2 lg:col-span-4">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${month.label}` : `Collapse ${month.label}`}
            className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-chip text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", collapsed && "-rotate-90")} aria-hidden />
          </button>
          <h2 className="text-sm font-semibold tracking-tight text-text">
            {month.label}
          </h2>
          <span className="text-xs tabular-nums text-text-subtle">
            {month.periods.length}{" "}
            {month.periods.length === 1 ? "period" : "periods"}
            {runCount !== month.periods.length && (
              <>
                {" · "}
                {runCount} {runCount === 1 ? "run" : "runs"}
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-5 whitespace-nowrap lg:contents">
          <span
            className="hidden pr-2 text-right text-sm tabular-nums text-text-muted sm:block"
            title={
              grossIncomplete
                ? "Partial: W2 paystub periods carry net pay only, so their gross isn't included here."
                : "Month gross"
            }
          >
            <MoneyDisplay cents={gross} />
            {grossIncomplete ? "*" : ""}
          </span>
          <span className="text-right text-sm font-semibold tabular-nums text-text" title="Month net">
            <MoneyDisplay cents={net} />
          </span>
          <span className="hidden text-right text-sm tabular-nums text-text-muted lg:block" title="Employees paid">
            {employees > 0 ? employees : ""}
          </span>
          <span aria-hidden className="hidden lg:block" />
        </div>
      </header>

      {/* Period statement lines, hairline-separated */}
      {!collapsed && (
        <div className="divide-y divide-border/60">
          {month.periods.map((p) => (
            <PeriodLine key={p.periodId} group={p} {...handlers} />
          ))}
        </div>
      )}
    </section>
  );
}
