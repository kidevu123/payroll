// Admin calendar — month grid showing approved (and pending) time-off
// across all employees, plus a side rail with pending requests so
// admins can approve/reject without leaving the page. /requests now
// redirects here; this is the single canonical surface for "who's out
// when" + "what's waiting on me". Birthdays render as pink chips.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadCalendarView } from "@/lib/db/queries/calendar-view";
import { CalendarAgendaTab } from "@/components/calendar/agenda-tab";
import { CalendarMonthTab } from "@/components/calendar/month-tab";
import { CalendarTotalsTab } from "@/components/calendar/totals-tab";
import { TabPill } from "@/components/calendar/parts";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; tab?: string }>;
}) {
  const view = await loadCalendarView(await searchParams);
  const {
    tab,
    today,
    monthName,
    prev,
    next,
  } = view;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-title tracking-tight antialiased text-text">
            Calendar &amp; requests
          </h1>
          <p className="text-sm text-text-muted">
            {tab === "totals"
              ? `Time off taken so far in ${today.getUTCFullYear()}.`
              : "Approved time-off across all employees. Pending requests show as faded bars on the grid and as actionable rows in the rail."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "calendar" && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/calendar?year=${prev.getUTCFullYear()}&month=${prev.getUTCMonth() + 1}`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              </Button>
              <span className="font-medium">{monthName}</span>
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/calendar?year=${next.getUTCFullYear()}&month=${next.getUTCMonth() + 1}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link href="/calendar">Today</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tab nav. Pills, no chrome — keeps the page header light. */}
      <div className="flex items-center gap-1 border-b border-border">
        <TabPill href="/calendar" label="Calendar" active={tab === "calendar"} />
        <TabPill
          href="/calendar?tab=agenda"
          label="Agenda"
          active={tab === "agenda"}
        />
        <TabPill
          href="/calendar?tab=totals"
          label="Time off totals"
          active={tab === "totals"}
        />
      </div>

      <CalendarTotalsTab view={view} />

      <CalendarAgendaTab view={view} />

      <CalendarMonthTab view={view} />

    </div>
  );
}
