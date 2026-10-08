// The Agenda tab: one row per absence with a single Edit / Cancel pair.
import {
  CancelTimeOffActionButton,
  EditApprovedTimeOffAction,
} from "@/app/(admin)/requests/request-actions";
import { isAdminManageableTimeOff } from "@/lib/time-off/change-request";
import { TYPE_COLORS, TYPE_LABEL, nameFromMap } from "@/lib/time/calendar-grid";
import type { CalendarView } from "@/lib/db/queries/calendar-view";

export function CalendarAgendaTab({ view }: { view: CalendarView }) {
  const { tab, approved, empMap, todayIso, partialLabel, monthName } = view;
  return (
    <>
      {/* Agenda — one row per absence with a SINGLE Edit/Cancel pair. The
          month grid necessarily repeats a visual bar (and its actions) on
          every day a leave spans; that's dozens of duplicated controls in the
          reading order for a multi-week leave. This view is the keyboard /
          screen-reader friendly path: each absence is one actionable item. */}
      {tab === "agenda" && (
        <div className="rounded-card border border-border bg-surface">
          {approved.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-muted">
              No approved time-off in {monthName}.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {[...approved]
                .sort((a, b) =>
                  a.startDate < b.startDate
                    ? -1
                    : a.startDate > b.startDate
                      ? 1
                      : nameFromMap(empMap, a.employeeId).localeCompare(
                          nameFromMap(empMap, b.employeeId),
                        ),
                )
                .map((r) => {
                  const manageable = isAdminManageableTimeOff(r, todayIso);
                  const partial = partialLabel(
                    r.partialStartTime,
                    r.partialEndTime,
                  );
                  return (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {nameFromMap(empMap, r.employeeId)}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-chip border px-1.5 py-0.5 text-[11px] ${TYPE_COLORS[r.type] ?? TYPE_COLORS.OTHER}`}
                          >
                            {TYPE_LABEL[r.type] ?? r.type}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-muted tabular-nums">
                          {r.startDate}
                          {r.startDate !== r.endDate ? ` – ${r.endDate}` : ""}
                          {partial ? ` · ${partial}` : ""}
                        </div>
                        {r.reason && (
                          <p className="mt-0.5 text-[11px] text-text-subtle line-clamp-1">
                            {r.reason}
                          </p>
                        )}
                      </div>
                      {manageable && (
                        <div className="flex items-center gap-2 shrink-0">
                          <EditApprovedTimeOffAction
                            request={{
                              id: r.id,
                              startDate: r.startDate,
                              endDate: r.endDate,
                              type: r.type as
                                | "UNPAID"
                                | "SICK"
                                | "PERSONAL"
                                | "OTHER",
                              reason: r.reason,
                            }}
                          />
                          <CancelTimeOffActionButton
                            requestId={r.id}
                            status="APPROVED"
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
