// Phone / tablet: everyone's status for ONE day, as a single divided list.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MOBILE_STATUS, timeInitials, type GridRow } from "@/lib/time-grid/cell-state";
import { formatTimeShort } from "@/lib/utils";

export function AttendanceList({
  rows,
  selectedDay,
  tz,
  returnTo,
}: {
  rows: GridRow[];
  selectedDay: string;
  tz: string;
  returnTo: string;
}) {
  return (
    <ul className="lg:hidden divide-y divide-border/60 overflow-hidden rounded-card border border-border bg-surface shadow-card">
      {rows.length === 0 && (
        <li className="px-4 py-8 text-center text-sm text-text-muted">
          No hourly employees on this schedule.
        </li>
      )}
      {rows.map(({ e, state, sorted, cellPeriodId, closedMs }) => {
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalMin = Math.round(closedMs / 60000);
        const meta = MOBILE_STATUS[state];
        const range = first
          ? `${formatTimeShort(first.clockIn, tz)} – ${
              last && last.clockOut
                ? formatTimeShort(last.clockOut, tz)
                : "open"
            }`
          : state === "future"
            ? "Not yet worked"
            : state === "missed"
              ? "No punches"
              : "—";
        const hLabel =
          totalMin > 0 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : "";
        const inner = (
          <div className="flex min-h-[3.75rem] items-center gap-3 px-3.5 py-2.5">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-text-muted"
            >
              {timeInitials(e.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text">
                {e.displayName}
              </div>
              <div className="truncate text-xs tabular-nums text-text-muted">
                {range}
                {hLabel ? ` · ${hLabel}` : ""}
                {sorted.length > 1 ? ` · ${sorted.length} punches` : ""}
              </div>
            </div>
            {state !== "future" && (
              <span
                className="inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                  color: meta.color,
                }}
              >
                {meta.label}
              </span>
            )}
            {cellPeriodId ? (
              <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
            ) : null}
          </div>
        );
        return (
          <li key={e.id}>
            {cellPeriodId ? (
              <Link
                href={`/time/${cellPeriodId}/${selectedDay}/${e.id}?${new URLSearchParams({ returnTo })}`}
                className="block transition-colors active:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700/60"
              >
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
