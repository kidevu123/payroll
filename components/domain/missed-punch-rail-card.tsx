// Missed-punch review rail card. Self-contained async server component so it
// can drop into any rail (currently the Time page) with a single line — it
// fetches its own pending requests + employee names and collapses to nothing
// when the queue is empty. Moved here from the Calendar rail: missed punches
// are a timekeeping concern, so they live next to the time grid, while the
// Calendar rail stays focused on time-off.
import { MessageSquareWarning } from "lucide-react";
import { listPendingMissedPunchRequestsForReview } from "@/lib/db/queries/requests";
import { listEmployees } from "@/lib/db/queries/employees";
import { MissedPunchReviewSummary } from "@/components/domain/missed-punch-review-summary";
import { MissedPunchActions } from "@/app/(admin)/requests/request-actions";

export async function MissedPunchRailCard({ timezone }: { timezone: string }) {
  const [pending, employees] = await Promise.all([
    listPendingMissedPunchRequestsForReview(timezone).catch(() => []),
    listEmployees().catch(() => []),
  ]);
  if (pending.length === 0) return null;

  const nameById = new Map(employees.map((e) => [e.id, e.displayName]));

  return (
    <div className="rounded-card border border-border bg-surface p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-warning-800">
        <MessageSquareWarning className="h-3.5 w-3.5" />
        Missed punches ({pending.length})
      </div>
      {pending.map(({ request: r, review }) => (
        <div
          key={r.id}
          className="rounded-input border border-border bg-surface-2/40 p-2 space-y-1.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium truncate">
              {nameById.get(r.employeeId) ?? r.employeeId}
            </span>
            <span className="text-[11px] text-text-muted tabular-nums shrink-0">
              {r.date}
            </span>
          </div>
          <MissedPunchReviewSummary ctx={review} timezone={timezone} />
          {r.reason && (
            <p className="text-[11px] text-text-muted line-clamp-2">{r.reason}</p>
          )}
          <MissedPunchActions requestId={r.id} />
        </div>
      ))}
    </div>
  );
}
