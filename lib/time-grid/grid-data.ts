// Shapes the raw rows the /time page loads into the two lookups the grid
// needs: approved time off per employee-day, and punches per employee-day.
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { companyDayIso } from "@/lib/time/company-day";
import type { TimeOffType } from "./cell-state";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "employeeId|YYYY-MM-DD" -> time-off type, one entry per day of each request.
 * SCHEDULE_NOTE is a heads-up, not actual time off: skipped, so the grid still
 * shows that day's punches instead of hiding the cell behind a label.
 */
export function buildTimeOffByDay(
  requests: { employeeId: string; startDate: string; endDate: string; type: string }[],
): Map<string, TimeOffType> {
  const out = new Map<string, TimeOffType>();
  for (const r of requests) {
    if (r.type === "SCHEDULE_NOTE") continue;
    const start = new Date(`${r.startDate}T00:00:00Z`);
    const end = new Date(`${r.endDate}T00:00:00Z`);
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d = new Date(d.getTime() + MS_PER_DAY)
    ) {
      out.set(`${r.employeeId}|${d.toISOString().slice(0, 10)}`, r.type as TimeOffType);
    }
  }
  return out;
}

/**
 * employeeId -> day -> punches, keyed by the clock-in day in the company
 * timezone. Only employees on the grid get an entry. Near-duplicates within a
 * cell are collapsed so one shift recorded twice does not read as two.
 */
export function groupPunchesByCell<
  T extends { id: string; employeeId: string; clockIn: Date; clockOut: Date | null },
>(punches: T[], employeeIds: string[], tz: string): Map<string, Map<string, T[]>> {
  const grid = new Map<string, Map<string, T[]>>();
  for (const id of employeeIds) grid.set(id, new Map());
  for (const p of punches) {
    const byDay = grid.get(p.employeeId);
    if (!byDay) continue;
    const day = companyDayIso(p.clockIn, tz);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  for (const byDay of grid.values()) {
    for (const [day, list] of byDay) byDay.set(day, dedupNearDuplicatePunches(list));
  }
  return grid;
}
