// Admin Requests inbox. Two tabs: Missed punches | Time off. Inline
// approve/reject. Phase 6 will polish; Phase 5 just makes it functional.

import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
import { listEmployees } from "@/lib/db/queries/employees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageSquareWarning, Plane } from "lucide-react";
import { MissedPunchActions, TimeOffActions } from "./request-actions";

function shortDate(d: Date | string): string {
  const s = typeof d === "string" ? d : d.toISOString();
  return s.slice(0, 16).replace("T", " ");
}

export default async function RequestsPage() {
  const [missedPunches, timeOff, employees] = await Promise.all([
    listPendingMissedPunchRequests(),
    listPendingTimeOffRequests(),
    listEmployees(),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Requests</h1>
        <p className="text-sm text-[--text-muted]">
          {missedPunches.length} missed-punch · {timeOff.length} time-off
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <MessageSquareWarning className="h-5 w-5 text-amber-700" />
          <CardTitle className="text-base">Missed punches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {missedPunches.length === 0 ? (
            <EmptyState
              icon={MessageSquareWarning}
              title="No missed-punch requests pending"
              description="When employees submit fixes, they appear here."
            />
          ) : (
            missedPunches.map((r) => {
              const emp = empById.get(r.employeeId);
              return (
                <div
                  key={r.id}
                  className="rounded-[--radius-card] border border-[--border] bg-[--surface] p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">
                        {emp?.displayName ?? r.employeeId}
                      </div>
                      <div className="text-xs text-[--text-muted]">
                        {r.date} · submitted {shortDate(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-xs font-mono text-[--text-muted]">
                      {r.claimedClockIn ? r.claimedClockIn.toISOString().slice(11, 16) : "—"} →{" "}
                      {r.claimedClockOut ? r.claimedClockOut.toISOString().slice(11, 16) : "—"}
                    </div>
                  </div>
                  <p className="text-sm">{r.reason}</p>
                  <MissedPunchActions requestId={r.id} />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Plane className="h-5 w-5 text-sky-700" />
          <CardTitle className="text-base">Time off</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {timeOff.length === 0 ? (
            <EmptyState
              icon={Plane}
              title="No time-off requests pending"
              description="When employees request time off, it lands here."
            />
          ) : (
            timeOff.map((r) => {
              const emp = empById.get(r.employeeId);
              return (
                <div
                  key={r.id}
                  className="rounded-[--radius-card] border border-[--border] bg-[--surface] p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">
                        {emp?.displayName ?? r.employeeId}
                      </div>
                      <div className="text-xs text-[--text-muted]">
                        {r.startDate} – {r.endDate} · {r.type.toLowerCase()}
                      </div>
                    </div>
                    <div className="text-xs text-[--text-muted]">
                      submitted {shortDate(r.createdAt)}
                    </div>
                  </div>
                  {r.reason && <p className="text-sm">{r.reason}</p>}
                  <TimeOffActions requestId={r.id} employeeId={r.employeeId} />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
