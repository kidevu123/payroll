// The Time off totals tab: year-to-date days per employee.
import Link from "next/link";
import type { CalendarView } from "@/lib/db/queries/calendar-view";

export function CalendarTotalsTab({ view }: { view: CalendarView }) {
  const { tab, totals } = view;
  return (
    <>
      {tab === "totals" && (
        <div className="rounded-card border border-border bg-surface">
          {totals.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              No approved time-off yet this year.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {totals.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                >
                  <Link
                    href={`/employees/${r.id}`}
                    className="text-sm font-medium hover:underline truncate"
                  >
                    {r.name}
                  </Link>
                  <span className="text-sm tabular-nums text-text-muted shrink-0">
                    {r.days} {r.days === 1 ? "day" : "days"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-4 py-2.5 text-xs">
            <Link
              href="/reports/time-off"
              className="text-brand-700 hover:underline"
            >
              View full breakdown →
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
