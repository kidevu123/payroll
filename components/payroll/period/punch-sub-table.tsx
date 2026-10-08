// The expanded detail under an employee row: that employee's punches for the
// period, day by day.
import Link from "next/link";
import type React from "react";
import { companyDayIso } from "@/lib/time/company-day";
import { formatDayLabel, formatHm } from "@/lib/payroll/period-view";

export function PunchSubTable({
  punches,
  tz,
  formatHm,
  formatDayLabel,
  periodId,
  employeeId,
  canEdit,
  today,
}: {
  punches: { id: string; clockIn: Date | string; clockOut: Date | string | null }[];
  tz: string;
  formatHm: (d: Date | null, tz: string) => string;
  formatDayLabel: (dateIso: string, tz: string) => string;
  periodId: string;
  employeeId: string;
  canEdit: boolean;
  today: string;
}) {
  if (punches.length === 0) {
    return <div className="px-9 pb-3 text-xs text-text-muted">No punches.</div>;
  }
  const byDay = new Map<string, typeof punches>();
  for (const p of punches) {
    const d = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    const day = companyDayIso(d, tz);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="overflow-x-auto px-3 pb-3 pt-1 md:px-9">
      <table className="min-w-[22rem] text-xs md:min-w-full">
        <thead className="text-left text-micro uppercase text-text-subtle border-b border-border/60">
          <tr>
            <th className="py-1 pr-3 font-semibold">Day</th>
            <th className="py-1 px-3 font-semibold">In</th>
            <th className="py-1 px-3 font-semibold">Out</th>
            <th className="py-1 px-3 font-semibold text-right">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {days.flatMap(([day, ps]) =>
            ps
              .sort((a, b) => {
                const ai = a.clockIn instanceof Date ? a.clockIn : new Date(a.clockIn);
                const bi = b.clockIn instanceof Date ? b.clockIn : new Date(b.clockIn);
                return ai.getTime() - bi.getTime();
              })
              .map((p, i) => {
                const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
                const outT = p.clockOut
                  ? p.clockOut instanceof Date
                    ? p.clockOut
                    : new Date(p.clockOut)
                  : null;
                const hours = outT
                  ? (outT.getTime() - inT.getTime()) / 3_600_000
                  : null;
                const isMissingClockOut = !outT;
                // Distinguish "still working today" from "forgot to clock out
                // on a prior day" — only show the fix link for stale open
                // punches. A punch from today with no clock-out is in-progress
                // (the device hasn't synced the clock-out yet).
                const isInProgress = isMissingClockOut && day >= today;
                const isStaleOpen = isMissingClockOut && day < today;
                return (
                  <tr key={p.id} className="hover:bg-surface-2/40">
                    <td className="py-0.5 pr-3 text-text-muted">
                      {i === 0 ? formatDayLabel(day, tz) : ""}
                    </td>
                    <td className="py-0.5 px-3 tabular-nums">{formatHm(inT, tz)}</td>
                    <td className="py-0.5 px-3 tabular-nums">
                      {isInProgress ? (
                        <span className="text-brand-700 font-medium">open</span>
                      ) : isStaleOpen && canEdit ? (
                        <Link
                          href={`/time/${periodId}/${day}/${employeeId}?${new URLSearchParams({ returnTo: `/payroll/${periodId}` })}`}
                          className="text-warning-700 underline underline-offset-2 hover:text-warning-900"
                        >
                          missing — fix
                        </Link>
                      ) : (
                        formatHm(outT, tz)
                      )}
                    </td>
                    <td className="py-0.5 px-3 text-right tabular-nums">
                      {hours !== null ? hours.toFixed(2) : "—"}
                    </td>
                  </tr>
                );
              }),
          )}
        </tbody>
      </table>
    </div>
  );
}
