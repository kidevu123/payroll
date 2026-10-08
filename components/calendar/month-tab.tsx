// The Calendar tab: the month grid with its legend, and the rail (overview
// tiles, pending requests, coverage).
import { CalendarGrid } from "@/components/calendar/month-grid";
import { CalendarRail } from "@/components/calendar/month-rail";
import type { CalendarView } from "@/lib/db/queries/calendar-view";

export function CalendarMonthTab({ view }: { view: CalendarView }) {
  const { tab } = view;
  return (
    <>
      {tab === "calendar" && (

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <CalendarGrid view={view} />
        <CalendarRail view={view} />
      </div>
      )}
    </>
  );
}
