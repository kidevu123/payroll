// The desktop /time grid: one row per employee, one column per day. A bounded
// two-axis scroll region so BOTH the employee column (sticky left) and the
// day header (sticky top) stay pinned while scrolling a wide or tall roster.
import Link from "next/link";
import { PunchCell } from "@/components/time/punch-cell";
import { cellAriaLabel, cellKey, type GridCell } from "@/lib/time-grid/cell-state";

export function DesktopGrid({
  employees,
  days,
  today,
  cells,
  tz,
  returnTo,
}: {
  employees: { id: string; displayName: string }[];
  days: string[];
  today: string;
  cells: Map<string, GridCell>;
  tz: string;
  returnTo: string;
}) {
  return (
    <div className="hidden lg:block max-h-[72vh] overflow-auto rounded-card border border-border/70 bg-surface shadow-card-strong">
  <table className="min-w-full text-body border-collapse">
    <thead>
      {/* Below md the shell's fixed top bar owns y=0, so a plain
          top-0 pinned this header underneath it and it vanished while
          scrolling on phones. */}
      <tr className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 border-b border-border/80 bg-surface-2/95 backdrop-blur md:top-0">
        <th className="sticky left-0 z-30 bg-surface-2 text-left px-4 py-2.5 text-micro text-text-subtle uppercase whitespace-nowrap border-r border-border/50">
          Employee
        </th>
        {days.map((d) => {
          const isToday = d === today;
          return (
            <th
              key={d}
              className={`w-28 py-2.5 px-2 text-center whitespace-nowrap border-b border-border/40 ${isToday ? "bg-brand-50" : "bg-surface-2"}`}
            >
              <span className={`flex flex-col items-center leading-tight ${isToday ? "text-brand-700" : "text-text-subtle"}`}>
                <span className="text-micro uppercase">
                  {new Intl.DateTimeFormat("en-US", {
                    weekday: "short",
                    timeZone: "UTC",
                  }).format(new Date(`${d}T00:00:00Z`))}
                </span>
                <span className="tabular-nums text-[11px] font-semibold mt-0.5">
                  {new Intl.DateTimeFormat("en-US", {
                    month: "numeric",
                    day: "numeric",
                    timeZone: "UTC",
                  }).format(new Date(`${d}T00:00:00Z`))}
                </span>
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
    <tbody>
      {employees.map((e) => (
        <tr
          key={e.id}
          className="border-t border-border/40 group hover:bg-surface-2/40 transition-colors"
        >
          <td className="sticky left-0 z-10 bg-surface group-hover:bg-surface-2/40 px-4 py-2 font-medium text-body whitespace-nowrap border-r border-border/40 transition-colors">
            <Link
              href={`/employees/${e.id}`}
              className="text-text hover:text-brand-700 hover:underline underline-offset-2 transition-colors"
            >
              {e.displayName}
            </Link>
          </td>
          {days.map((d) => {
            const isToday = d === today;
            const { state, sorted, closedMs, cellPeriodId } = cells.get(cellKey(e.id, d))!;
            const first = sorted[0];
            const last = sorted[sorted.length - 1];
            const hours = closedMs / (1000 * 60 * 60);

            const cellContent = (
              <PunchCell
                state={state}
                first={first}
                last={last}
                count={sorted.length}
                hours={hours}
                tz={tz}
              />
            );

            return (
              <td
                key={d}
                className={`py-1.5 px-1.5 align-middle text-center ${isToday ? "bg-brand-50/25 group-hover:bg-brand-50/40" : ""}`}
              >
                {cellPeriodId ? (
                  <Link
                    href={`/time/${cellPeriodId}/${d}/${e.id}?${new URLSearchParams({ returnTo })}`}
                    className="block"
                    aria-label={cellAriaLabel(state, sorted, tz)}
                  >
                    {cellContent}
                  </Link>
                ) : (
                  <span aria-label={cellAriaLabel(state, sorted, tz)}>
                    {cellContent}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </tbody>
  </table>
    </div>
  );
}
