// Admin calendar — month grid showing approved (and pending) time-off
// across all employees. Lets the owner see at a glance who's out next
// week without scrolling through the requests inbox.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  listApprovedInRange,
  listPendingInRange,
} from "@/lib/db/queries/time-off";
import { listEmployees } from "@/lib/db/queries/employees";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function startOfMonth(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0, 1));
}

function endOfMonth(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0 + 1, 0));
}

function eachDayBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(isoDay(d));
  }
  return out;
}

const TYPE_COLORS: Record<string, string> = {
  PERSONAL: "bg-emerald-100 text-emerald-800 border-emerald-300",
  SICK: "bg-amber-100 text-amber-800 border-amber-300",
  UNPAID: "bg-slate-100 text-slate-800 border-slate-300",
  OTHER: "bg-violet-100 text-violet-800 border-violet-300",
};

const TYPE_LABEL: Record<string, string> = {
  PERSONAL: "PTO",
  SICK: "Sick",
  UNPAID: "Unpaid",
  OTHER: "Other",
};

function nameFromMap(
  empMap: Map<string, string>,
  id: string,
): string {
  return empMap.get(id) ?? "Unknown";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const params = await searchParams;
  const today = new Date();
  const year = Number(params.year) || today.getUTCFullYear();
  const month0 = Math.max(
    0,
    Math.min(11, (Number(params.month) || today.getUTCMonth() + 1) - 1),
  );

  const monthStart = startOfMonth(year, month0);
  const monthEnd = endOfMonth(year, month0);
  const startIso = isoDay(monthStart);
  const endIso = isoDay(monthEnd);

  // Pad the grid to whole weeks. Week starts Sunday — that's the most common
  // US calendar convention. Adjust if the company TZ ever needs Monday-first.
  const padBefore = monthStart.getUTCDay(); // 0=Sun
  const padAfter = 6 - monthEnd.getUTCDay();
  const gridStart = new Date(monthStart.getTime() - padBefore * MS_PER_DAY);
  const gridEnd = new Date(monthEnd.getTime() + padAfter * MS_PER_DAY);

  const [approved, pending, employees] = await Promise.all([
    listApprovedInRange(startIso, endIso),
    listPendingInRange(startIso, endIso),
    listEmployees(),
  ]);
  const empMap = new Map(employees.map((e) => [e.id, e.displayName]));

  // Bucket requests by ISO day for fast cell lookup.
  const cellByDay = new Map<
    string,
    {
      approved: { id: string; type: string; emp: string }[];
      pending: { id: string; type: string; emp: string }[];
    }
  >();
  for (const r of approved) {
    for (const day of eachDayBetween(r.startDate, r.endDate)) {
      if (day < startIso || day > endIso) continue;
      const cell = cellByDay.get(day) ?? { approved: [], pending: [] };
      cell.approved.push({
        id: r.id,
        type: r.type,
        emp: nameFromMap(empMap, r.employeeId),
      });
      cellByDay.set(day, cell);
    }
  }
  for (const r of pending) {
    for (const day of eachDayBetween(r.startDate, r.endDate)) {
      if (day < startIso || day > endIso) continue;
      const cell = cellByDay.get(day) ?? { approved: [], pending: [] };
      cell.pending.push({
        id: r.id,
        type: r.type,
        emp: nameFromMap(empMap, r.employeeId),
      });
      cellByDay.set(day, cell);
    }
  }

  const days: string[] = eachDayBetween(isoDay(gridStart), isoDay(gridEnd));
  const todayIso = isoDay(today);

  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthStart);

  const prev = new Date(monthStart.getTime() - 1 * MS_PER_DAY);
  const next = new Date(monthEnd.getTime() + 1 * MS_PER_DAY);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-text-muted">
            Approved time-off across all employees. Pending requests show as
            faded bars.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="sr-only">{monthName}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
            <Legend label="PTO" className={TYPE_COLORS.PERSONAL!} />
            <Legend label="Sick" className={TYPE_COLORS.SICK!} />
            <Legend label="Unpaid" className={TYPE_COLORS.UNPAID!} />
            <Legend label="Other" className={TYPE_COLORS.OTHER!} />
            <span className="text-text-muted">
              · Faded = pending approval
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-text-subtle border-b border-border pb-1 mb-1">
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
              };
              const inMonth = day >= startIso && day <= endIso;
              const isToday = day === todayIso;
              return (
                <div
                  key={day}
                  className={`min-h-24 rounded-card border p-1.5 ${
                    inMonth ? "bg-surface" : "bg-surface-2/40 opacity-60"
                  } ${
                    isToday ? "ring-2 ring-brand-700" : "border-border"
                  }`}
                >
                  <div className="text-[10px] font-medium text-text-muted">
                    {Number(day.slice(8))}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {cell.approved.slice(0, 3).map((r) => (
                      <div
                        key={r.id}
                        className={`truncate rounded border px-1 py-0.5 text-[10px] ${
                          TYPE_COLORS[r.type] ?? TYPE_COLORS.OTHER
                        }`}
                        title={`${r.emp} — ${TYPE_LABEL[r.type] ?? r.type}`}
                      >
                        {r.emp}
                      </div>
                    ))}
                    {cell.pending.slice(0, 2).map((r) => (
                      <div
                        key={r.id}
                        className={`truncate rounded border border-dashed px-1 py-0.5 text-[10px] opacity-60 ${
                          TYPE_COLORS[r.type] ?? TYPE_COLORS.OTHER
                        }`}
                        title={`${r.emp} — ${TYPE_LABEL[r.type] ?? r.type} (pending)`}
                      >
                        {r.emp}
                      </div>
                    ))}
                    {cell.approved.length + cell.pending.length > 5 && (
                      <div className="text-[10px] text-text-muted">
                        +{cell.approved.length + cell.pending.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Legend({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${className}`}>
      {label}
    </span>
  );
}
