import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { listEmployees } from "@/lib/db/queries/employees";
import {
  ensureNextPeriod,
  getCurrentPeriod,
  getMostRecentPeriod,
} from "@/lib/db/queries/pay-periods";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function todayInTimezone(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

function eachDay(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function dayOf(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

type CellState = "complete" | "incomplete" | "missed" | "inactive";

function cellClasses(state: CellState): string {
  switch (state) {
    case "complete":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "incomplete":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "missed":
      return "bg-red-50 text-red-700 border-red-200";
    case "inactive":
      return "bg-surface-2 text-text-muted border-border";
  }
}

export default async function TimePage() {
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);

  // Make sure a period exists for today (idempotent).
  await ensureNextPeriod(today);
  const period =
    (await getCurrentPeriod(today)) ?? (await getMostRecentPeriod());

  if (!period) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No pay periods yet"
        description="The first period is created once an employee is added."
        action={
          <Button asChild>
            <Link href="/employees/new">Add an employee</Link>
          </Button>
        }
      />
    );
  }

  const days = eachDay(period.startDate, period.endDate);
  const [employees, punches] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    listPunches({ periodId: period.id }),
  ]);

  // Group punches by employeeId + day.
  const grid = new Map<string, Map<string, typeof punches>>();
  for (const e of employees) grid.set(e.id, new Map());
  for (const p of punches) {
    const day = dayOf(p.clockIn, company.timezone);
    const byDay = grid.get(p.employeeId);
    if (!byDay) continue;
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Time</h1>
          <p className="text-sm text-text-muted">
            Current period: {period.startDate} to {period.endDate}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Legend label="Complete" state="complete" />
          <Legend label="Incomplete" state="incomplete" />
          <Legend label="Missed" state="missed" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-surface-2/80 backdrop-blur text-text-subtle uppercase text-[10px] tracking-wider">
            <tr>
              <th className="text-left px-3 py-2.5 font-medium">Employee</th>
              {days.map((d) => (
                <th key={d} className="px-2 py-2.5 font-medium font-mono tabular-nums">
                  {new Intl.DateTimeFormat("en-US", {
                    weekday: "short",
                    month: "numeric",
                    day: "numeric",
                  }).format(new Date(`${d}T00:00:00Z`))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-border hover:bg-surface-2/40 transition-colors">
                <td className="px-3 py-2 font-medium">{e.displayName}</td>
                {days.map((d) => {
                  const list = grid.get(e.id)?.get(d) ?? [];
                  let state: CellState;
                  if (list.length === 0) state = "missed";
                  else if (list.some((p) => !p.clockOut)) state = "incomplete";
                  else state = "complete";
                  if (e.status !== "ACTIVE") state = "inactive";
                  return (
                    <td key={d} className="p-1 align-middle">
                      <Link
                        href={`/time/${period.id}/${d}/${e.id}`}
                        className={`flex items-center justify-center rounded-chip border h-9 w-full ${cellClasses(state)} hover:brightness-95`}
                      >
                        {list.length > 0 ? `${list.length}` : "—"}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend({ label, state }: { label: string; state: CellState }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 ${cellClasses(state)}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-60" /> {label}
    </span>
  );
}
