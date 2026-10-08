// Date arithmetic and the time-off type palette for the admin calendar.
// Moved out of app/(admin)/calendar/page.tsx so they can be tested.
export const MS_PER_DAY = 86_400_000;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function startOfMonth(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0, 1));
}

export function endOfMonth(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0 + 1, 0));
}

export function eachDayBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(isoDay(d));
  }
  return out;
}

export const TYPE_COLORS: Record<string, string> = {
  PERSONAL: "bg-success-100 text-success-800 border-success-200",
  SICK: "bg-warning-100 text-warning-800 border-warning-200",
  UNPAID: "bg-surface-2 text-text-muted border-border",
  OTHER:
    "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/40",
  // Distinct from time-off bars — heads-up only, no payroll impact.
  // Soft blue says "informational" without competing with the
  // amber/emerald/cyan bars that count toward time-off totals.
  SCHEDULE_NOTE: "bg-info-50 text-info-800 border-info-200",
};

export const TYPE_LABEL: Record<string, string> = {
  PERSONAL: "PTO",
  SICK: "Sick",
  UNPAID: "Unpaid",
  OTHER: "Other",
  SCHEDULE_NOTE: "Note",
};

export function nameFromMap(
  empMap: Map<string, string>,
  id: string,
): string {
  return empMap.get(id) ?? "Unknown";
}
