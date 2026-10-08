// The month grid: legend, weekday header and one cell per day with its
// time-off bars, notes and birthdays.
import { Cake } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TYPE_COLORS } from "@/lib/time/calendar-grid";
import { CalendarEntry, Legend, TYPE_DOT } from "@/components/calendar/parts";
import type { CalendarView } from "@/lib/db/queries/calendar-view";


export function CalendarGrid({ view }: { view: CalendarView }) {
  const { startIso, endIso, todayIso, cellByDay, days, monthName } = view;
  return (
    <>
      <Card>
      <CardHeader className="pb-2">
        <CardTitle className="sr-only">{monthName}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
          <Legend label="PTO" className={TYPE_COLORS.PERSONAL!} />
          <Legend label="Sick" className={TYPE_COLORS.SICK!} />
          <Legend label="Unpaid" className={TYPE_COLORS.UNPAID!} />
          <Legend label="Other" className={TYPE_COLORS.OTHER!} />
          <Legend label="Note" className={TYPE_COLORS.SCHEDULE_NOTE!} />
          <Legend
            label="Birthday"
            className="bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-500/40"
          />
          <span className="text-text-muted">
            · Faded = pending approval
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-micro uppercase text-text-subtle border-b border-border pb-1 mb-1">
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const cell = cellByDay.get(day) ?? {
              approved: [],
              pending: [],
              birthdays: [],
            };
            const inMonth = day >= startIso && day <= endIso;
            const isToday = day === todayIso;
            // Combine approved + pending into one ordered list so we
            // present a single "people off" stack per day. Approved
            // first, then pending. Cap at MAX_VISIBLE; the rest is
            // summarised with a hover-revealed list.
            const MAX_VISIBLE = 3;
            const stack = [
              ...cell.approved.map((r) => ({ ...r, pending: false })),
              ...cell.pending.map((r) => ({ ...r, pending: true })),
            ];
            const visible = stack.slice(0, MAX_VISIBLE);
            const overflow = stack.slice(MAX_VISIBLE);
            return (
              <div
                key={day}
                className={`min-h-16 sm:min-h-24 rounded-card border p-1 sm:p-1.5 ${
                  inMonth ? "bg-surface" : "bg-surface-2/40 opacity-60"
                } ${
                  isToday ? "ring-2 ring-brand-700" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-muted">
                    {Number(day.slice(8))}
                  </span>
                  {cell.birthdays.length > 0 && (
                    <Cake
                      className="h-3 w-3 text-pink-600"
                      aria-hidden
                    />
                  )}
                </div>
                {cell.birthdays.length > 0 && (
                  // Always render the actual name. The previous build
                  // hid them in a `title` tooltip, which doesn't fire
                  // on touch — owner couldn't tell whose birthday it
                  // was without going to the employees page. Capped with
                  // a +N roll-up like the time-off entries so a day with
                  // many birthdays doesn't overflow the fixed cell.
                  <div className="mt-1 space-y-0.5">
                    {cell.birthdays.slice(0, MAX_VISIBLE).map((b, i) => (
                      <div
                        key={`bday-${day}-${i}`}
                        className="truncate rounded border border-pink-300 bg-pink-50 px-1.5 py-0.5 text-[11px] leading-tight text-pink-800 dark:border-pink-500/40 dark:bg-pink-500/15 dark:text-pink-300"
                        title={`${b.name} — birthday`}
                      >
                        {b.name}
                      </div>
                    ))}
                    {cell.birthdays.length > MAX_VISIBLE && (
                      <div
                        className="truncate px-1.5 text-[11px] font-medium leading-tight text-pink-700 dark:text-pink-300"
                        title={cell.birthdays
                          .slice(MAX_VISIBLE)
                          .map((b) => b.name)
                          .join(", ")}
                      >
                        +{cell.birthdays.length - MAX_VISIBLE} more
                      </div>
                    )}
                  </div>
                )}
                {/* Mobile: colored dots per entry (matches #69). Name bars
                    are too wide for a 7-col phone grid. */}
                {stack.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                    {stack.slice(0, 4).map((r, i) => (
                      <span
                        key={`dot-${day}-${i}`}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background: TYPE_DOT[r.type] ?? TYPE_DOT.OTHER,
                          opacity: r.pending ? 0.45 : 1,
                        }}
                      />
                    ))}
                  </div>
                )}
                <div className="mt-1 space-y-1 hidden sm:block">
                  {visible.map((r) => (
                    <CalendarEntry
                      key={`${day}-${r.id}`}
                      entry={r}
                    />
                  ))}
                  {overflow.length > 0 && (
                    <details className="group relative">
                      <summary
                        className="cursor-pointer list-none text-[11px] font-medium text-text-muted hover:text-text"
                        title={overflow.map((r) => r.emp).join(", ")}
                      >
                        +{overflow.length} more
                      </summary>
                      {/* Absolutely positioned so expanding the roll-up
                          doesn't stretch the whole 7-day row (matches the
                          edit popover pattern below). */}
                      <div className="absolute left-0 top-full z-20 mt-1 w-40 space-y-0.5 rounded-card border border-border bg-surface-2 p-1 shadow-pop">
                        {overflow.map((r) => (
                          <CalendarEntry
                            key={`${day}-overflow-${r.id}`}
                            entry={r}
                            compact
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
    </>
  );
}
