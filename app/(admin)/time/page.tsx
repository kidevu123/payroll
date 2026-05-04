import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { and, desc, eq, lte, gte, sql } from "drizzle-orm";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  ScheduleTabs,
  parseScheduleTab,
  scheduleTabToKind,
} from "@/components/domain/schedule-tabs";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getSetting } from "@/lib/settings/runtime";
import { formatHoursMinutes, formatTimeShort } from "@/lib/utils";
import { db } from "@/lib/db";
import { payPeriods, paySchedules } from "@/lib/db/schema";

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

/**
 * Pick the period to render for the current tab:
 *   - All        → the period covering today (or the most recent one)
 *   - Weekly     → the most recent period attached to a WEEKLY schedule
 *   - Semi-monthly → same, for SEMI_MONTHLY
 * SALARIED is filtered out of the Time grid entirely (no punches).
 */
async function pickPeriodForTab(
  kind: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | null,
  today: string,
): Promise<{
  id: string;
  startDate: string;
  endDate: string;
  payScheduleId: string | null;
} | null> {
  if (!kind) {
    const [current] = await db
      .select()
      .from(payPeriods)
      .where(
        and(
          lte(payPeriods.startDate, today),
          gte(payPeriods.endDate, today),
        ),
      )
      .limit(1);
    if (current) return current;
    const [mostRecent] = await db
      .select()
      .from(payPeriods)
      .orderBy(desc(payPeriods.startDate))
      .limit(1);
    return mostRecent ?? null;
  }
  // Tab-filtered: most recent period on a schedule of the requested kind.
  const rows = await db
    .select({
      id: payPeriods.id,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      payScheduleId: payPeriods.payScheduleId,
    })
    .from(payPeriods)
    .innerJoin(paySchedules, eq(payPeriods.payScheduleId, paySchedules.id))
    .where(eq(paySchedules.periodKind, kind))
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  return rows[0] ?? null;
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

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ schedule?: string }>;
}) {
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);
  const tab = parseScheduleTab((await searchParams).schedule);
  const kindFilter = scheduleTabToKind(tab);

  // Read-only — auto-create disabled. Period creation now belongs to
  // the CSV upload + manual punch flows. Tab-aware: when filtering by
  // weekly / semi-monthly, pick the most recent period whose schedule
  // matches the tab. Defaults to the schedule-agnostic latest period.
  const period = await pickPeriodForTab(kindFilter, today);

  if (!period) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No pay periods yet"
        description="Upload a CSV from /run-payroll/upload to create the first period, or add a manual punch."
        action={
          <Button asChild>
            <Link href="/run-payroll/upload">Upload CSV</Link>
          </Button>
        }
      />
    );
  }

  // Canonical 7-day work week: render Monday → Sunday regardless of
  // how the upload was scoped. Owner pulls punches early sometimes
  // (Mon-Fri because no work happened Sat-Sun) but the displayed
  // grid should still reflect the full pay week so empty Sat/Sun
  // cells are visible. eachDay only goes as far as the stored
  // end_date, so widen it to start+6 days when the stored range is
  // shorter.
  const canonicalEnd = (() => {
    const start = new Date(`${period.startDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() + 6);
    return start.toISOString().slice(0, 10);
  })();
  const lastDay =
    period.endDate < canonicalEnd ? canonicalEnd : period.endDate;
  const days = eachDay(period.startDate, lastDay);
  const [allActive, punches] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    listPunches({ periodId: period.id }),
  ]);
  // SALARIED staff don't punch — hide them from the grid so the admin
  // doesn't see "missed" red cells for everyone-on-salary every day.
  // Schedule-tab filter: when the admin picks Weekly / Semi-monthly,
  // only show employees on a matching schedule (employees with a NULL
  // schedule are wildcards and stay visible across both tabs).
  const employees = allActive
    .filter((e) => e.payType !== "SALARIED")
    .filter((e) => {
      if (!kindFilter) return true;
      if (e.payScheduleId === null) return true;
      return e.payScheduleId === period.payScheduleId;
    });

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
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Time</h1>
          <p className="text-sm text-text-muted">
            Current period: {period.startDate} to {lastDay}
          </p>
          <ScheduleTabs current={tab} basePath="/time" />
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
