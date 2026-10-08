// The calendar's right rail: month overview tiles, the pending-request queue
// and the coverage card. Sticky on desktop.
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TimeOffActions,
  CancelTimeOffActionButton,
} from "@/app/(admin)/requests/request-actions";
import { TimeOffOnBehalfForm } from "@/app/(admin)/requests/time-off-on-behalf-form";
import { Plane } from "lucide-react";
import { TYPE_LABEL } from "@/lib/time/calendar-grid";
import { OverviewStat } from "@/components/calendar/parts";
import type { CalendarView } from "@/lib/db/queries/calendar-view";


export function CalendarRail({ view }: { view: CalendarView }) {
  const { employees, pendingTimeOff, empById, partialLabel, monthName, pendingTotal, approvedCount, peopleOffSet, coveragePct } = view;
  return (
    <>
      {/* Pending requests rail. Sticky on desktop so it stays in view
          as the operator scrolls; collapses below the calendar on
          mobile. Empty-state collapses entirely when nothing's
          pending — calendar gets the full width. */}
      <aside className="lg:sticky lg:top-4 lg:self-start space-y-3">
        {/* Month overview — four stat tiles (matches the #58 rail). */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>{monthName} overview</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <OverviewStat tone="emerald" value={approvedCount} label="Approved" sub="Time-off requests" />
            <OverviewStat tone="amber" value={pendingTimeOff.length} label="Pending" sub="Awaiting approval" />
            <OverviewStat tone="cyan" value={peopleOffSet.size} label="People off" sub="This month" />
            <OverviewStat tone="blue" value={`${coveragePct}%`} label="Coverage" sub="Across all shifts" />
          </CardContent>
        </Card>

        {/* Pending heading + on-behalf form carded so they don't float
            as bare markup between the overview and coverage cards. */}
        <div className="rounded-card border border-border bg-surface p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              Pending {pendingTotal > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-100 px-1.5 text-[11px] font-medium text-warning-900">
                  {pendingTotal}
                </span>
              )}
            </h2>
            <TimeOffOnBehalfForm
              employees={employees
                .filter((e) => e.status !== "TERMINATED")
                .map((e) => ({ id: e.id, displayName: e.displayName }))}
            />
          </div>

          {pendingTotal === 0 ? (
            <div className="rounded-card border border-dashed border-border bg-surface-2/40 p-6 text-center text-xs text-text-muted">
              Nothing waiting on you. New requests show up here as
              employees submit them.
            </div>
          ) : (
            <>
              {pendingTimeOff.length > 0 && (
                <div className="rounded-card border border-border bg-surface p-3 space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-info-800">
                  <Plane className="h-3.5 w-3.5" />
                  Time off ({pendingTimeOff.length})
                </div>
                {pendingTimeOff.map((r) => {
                  const emp = empById.get(r.employeeId);
                  const partial = partialLabel(r.partialStartTime, r.partialEndTime);
                  return (
                    <div
                      key={r.id}
                      className="rounded-input border border-border bg-surface-2/40 p-2 space-y-1.5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium truncate">
                          {emp?.displayName ?? r.employeeId}
                        </span>
                        <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                          {r.startDate}
                          {r.startDate !== r.endDate ? ` – ${r.endDate}` : ""}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {r.changeRequestAction === "EDIT"
                          ? "change approved time off"
                          : r.changeRequestAction === "CANCEL"
                            ? "cancel approved time off"
                            : (TYPE_LABEL[r.type] ?? r.type).toLowerCase()}
                        {partial ? ` · ${partial}` : ""}
                      </div>
                      {r.reason && (
                        <p className="text-[11px] text-text-muted line-clamp-2">
                          {r.reason}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <TimeOffActions
                          requestId={r.id}
                          employeeId={r.employeeId}
                        />
                        <CancelTimeOffActionButton
                          requestId={r.id}
                          status="PENDING"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </>
          )}
        </div>

        {/* Need coverage? — quick jump to the attendance board to fill
            open shifts (matches the #58 rail). */}
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Need coverage?</div>
              <p className="mt-0.5 text-xs text-text-muted">
                Find available team members for open shifts.
              </p>
              <Link
                href="/time"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                Find coverage <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"
            >
              <Users className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
      </aside>
    </>
  );
}
