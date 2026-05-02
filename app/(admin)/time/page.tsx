import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { listEmployees } from "@/lib/db/queries/employees";
import {
  ensureNextPeriod,
  getCurrentPeriod,
  getMostRecentPeriod,
} from "@/lib/db/queries/pay-periods";
import { listPunches } from "@/lib/db/queries/punches";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import { formatHoursMinutes, formatTimeShort } from "@/lib/utils";

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
  const [allActive, punches] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    listPunches({ periodId: period.id }),
  ]);
  // SALARIED staff don't punch — hide them from the grid so the admin
  // doesn't see "missed" red cells for everyone-on-salary every day.
  const employees = allActive.filter((e) => e.payType !== "SALARIED");

  // Group punches by employeeId + day, then dedup near-duplicates within
  // each cell so the grid doesn't show "1" / "2" cells for what's really
  // a single shift represented twice.
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
  for (const byDay of grid.values()) {
    for (const [day, list] of byDay) {
      byDay.set(day, dedupNearDuplicatePunches(list));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Time</h1>
          <p className="text-sm text-text-muted">
            Current period: {period.startDate} to {period.endDate}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="secondary">
            <Link href="/punches/new">
              <Plus className="h-4 w-4" /> Add manual punch
            </Link>
          </Button>
          <div className="flex items-center gap-3 text-xs">
            <Legend label="Complete" state="complete" />
            <Legend label="Incomplete" state="incomplete" />
            <Legend label="Missed" state="missed" />
          </div>
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

                  // Sort by clockIn so first-in / last-out are stable.
                  const sorted = [...list].sort(
                    (a, b) => a.clockIn.getTime() - b.clockIn.getTime(),
                  );
                  const first = sorted[0];
                  const last = sorted[sorted.length - 1];
                  // Sum hours across closed punches. Open punches contribute nothing
                  // (we don't show "elapsed so far"; the cell label "open" makes that obvious).
                  const closedMs = sorted.reduce((acc, p) => {
                    if (!p.clockOut) return acc;
                    return acc + (p.clockOut.getTime() - p.clockIn.getTime());
                  }, 0);
                  const hours = closedMs / (1000 * 60 * 60);

                  return (
                    <td key={d} className="p-1 align-middle">
                      <Link
                        href={`/time/${period.id}/${d}/${e.id}`}
                        className={`flex flex-col items-stretch justify-center rounded-chip border px-2 py-1 min-h-9 w-full text-[10px] leading-tight ${cellClasses(state)} hover:brightness-95`}
                        aria-label={cellAriaLabel(state, sorted, company.timezone)}
                      >
                        <PunchCellContent
                          state={state}
                          first={first}
                          last={last}
                          count={sorted.length}
                          hours={hours}
                          tz={company.timezone}
                        />
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

type PunchLite = { clockIn: Date; clockOut: Date | null };

function PunchCellContent({
  state,
  first,
  last,
  count,
  hours,
  tz,
}: {
  state: CellState;
  first: PunchLite | undefined;
  last: PunchLite | undefined;
  count: number;
  hours: number;
  tz: string;
}) {
  if (state === "inactive" || !first) {
    return (
      <span className="font-mono tabular-nums text-center opacity-70">—</span>
    );
  }
  const inLabel = formatTimeShort(first.clockIn, tz);
  const outLabel = last && last.clockOut ? formatTimeShort(last.clockOut, tz) : "?";
  return (
    <>
      <span className="font-mono tabular-nums text-center">
        {inLabel}–{outLabel}
        {count > 1 ? <span className="ml-1 opacity-70">+{count - 1}</span> : null}
      </span>
      <span className="text-center opacity-75">
        {state === "incomplete" ? "open" : formatHoursMinutes(hours)}
      </span>
    </>
  );
}

function cellAriaLabel(state: CellState, list: PunchLite[], tz: string): string {
  if (state === "inactive") return "Inactive employee";
  if (list.length === 0) return "No punches — missed day";
  const lines = list.map((p) => {
    const inS = formatTimeShort(p.clockIn, tz);
    const outS = p.clockOut ? formatTimeShort(p.clockOut, tz) : "still open";
    return `${inS} to ${outS}`;
  });
  return lines.join("; ");
}
