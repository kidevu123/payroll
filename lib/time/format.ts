
// Date and day helpers that used to exist as private copies in five+ files
// (time page, two payroll job handlers, three employee pages, two payroll
// modules). One implementation, tested; callers import from here.
import { companyDayIso } from "./company-day";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for the current instant in the company timezone. */
export function todayInCompanyTz(tz: string, now: Date = new Date()): string {
  return companyDayIso(now, tz);
}

/** Every calendar day from startIso to endIso inclusive, as "YYYY-MM-DD". */
export function eachDayIso(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** "YYYY-MM-DD" from a Date's UTC fields (period-boundary arithmetic). */
export function utcDayIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Locale clock time ("9:05 AM" / "9:05 a. m.") in the company zone; em dash for null. */
export function formatClockTime(d: Date | null, tz: string, locale: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}

/** The time part of a datetime-local value ("2026-10-05T09:30" -> "09:30"); a bare time passes through. */
export function timeOf(value: string): string {
  const t = value.indexOf("T");
  return t === -1 ? value : value.slice(t + 1);
}
