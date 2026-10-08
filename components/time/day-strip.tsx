// Phone / tablet: the day picker and the selected day's heading. The strip is
// a 7-column grid, so a weekly period fits the screen with no sideways
// scrolling and a monthly period wraps into a mini calendar. A weekly strip
// pins under the top bar so the day can be switched from anywhere in the list.
import Link from "next/link";
import type { ScheduleTab } from "@/components/domain/schedule-tabs";

export function DayStrip({
  days,
  selectedDay,
  today,
  issuesByDay,
  summary,
  tab,
  periodId,
}: {
  days: string[];
  selectedDay: string;
  today: string;
  issuesByDay: Map<string, number>;
  summary: string;
  tab: ScheduleTab;
  periodId: string;
}) {
  return (
    <>
      <nav
        aria-label="Day"
        className={`lg:hidden rounded-card border border-border bg-surface p-1.5 shadow-card ${
          days.length <= 7
            ? "sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-20 md:top-2"
            : ""
        }`}
      >
        <div className="grid grid-cols-7 gap-1">
          {days.length > 7 &&
            ["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
              <span
                key={i}
                aria-hidden
                className="pb-0.5 text-center text-[11px] font-medium text-text-subtle"
              >
                {l}
              </span>
            ))}
          {days.map((d, i) => {
            const isSel = d === selectedDay;
            const isToday = d === today;
            const dt = new Date(`${d}T12:00:00Z`);
            const dow = new Intl.DateTimeFormat("en-US", {
              weekday: "short",
              timeZone: "UTC",
            }).format(dt);
            const issues = issuesByDay.get(d) ?? 0;
            return (
              <Link
                key={d}
                href={`/time?${new URLSearchParams({
                  ...(tab !== "all" ? { schedule: tab } : {}),
                  ...(periodId ? { period: periodId } : {}),
                  day: d,
                })}`}
                aria-current={isSel ? "date" : undefined}
                aria-label={`${new Intl.DateTimeFormat("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(dt)}${issues > 0 ? `, ${issues} incomplete` : ""}`}
                // Monthly strips start on whatever weekday the 1st is.
                style={
                  i === 0 && days.length > 7
                    ? { gridColumnStart: ((dt.getUTCDay() + 6) % 7) + 1 }
                    : undefined
                }
                className={`relative flex min-h-[3.25rem] flex-col items-center justify-center rounded-input transition-colors ${
                  isSel
                    ? "bg-brand-700 text-white shadow-card"
                    : isToday
                      ? "text-brand-700 active:bg-surface-2/60"
                      : "text-text-muted active:bg-surface-2/60"
                }`}
              >
                {days.length <= 7 && (
                  <span className={`text-[11px] font-medium uppercase tracking-wide ${isSel ? "text-white/80" : ""}`}>
                    {dow}
                  </span>
                )}
                <span className={`text-sm tabular-nums ${isSel || isToday ? "font-bold" : "font-semibold text-text"}`}>
                  {dt.getUTCDate()}
                </span>
                {issues > 0 && (
                  <span
                    aria-hidden
                    className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isSel ? "bg-white" : "bg-warning-500"}`}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="lg:hidden flex items-baseline justify-between gap-3 px-1 pt-1">
        <h2 className="text-subheading text-text">
          {new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${selectedDay}T12:00:00Z`))}
          {selectedDay === today && (
            <span className="ml-2 align-middle text-caption font-medium text-brand-700">
              Today
            </span>
          )}
        </h2>
        <p className="shrink-0 text-caption tabular-nums text-text-muted">
          {summary}
        </p>
      </div>
    </>
  );
}
