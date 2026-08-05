import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format integer cents as USD. Display-only — never persist. */
export function formatMoney(cents: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Format hours to a configurable decimal precision. */
export function formatHours(hours: number, decimals = 2): string {
  return hours.toFixed(decimals);
}

/**
 * Compact 12-hour clock label like "7:32a" / "4:11p". Used in dense grids
 * where width is precious; pair with formatHM for the long form.
 */
export function formatTimeShort(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  let h = "";
  let m = "";
  let p = "";
  for (const part of parts) {
    if (part.type === "hour") h = part.value;
    else if (part.type === "minute") m = part.value;
    else if (part.type === "dayPeriod") p = part.value.toLowerCase().startsWith("a") ? "a" : "p";
  }
  return `${h}:${m}${p}`;
}

export function formatOptionalTimeShort(
  date: Date | null | undefined,
  timeZone: string,
): string {
  return date ? formatTimeShort(date, timeZone) : "—";
}

/**
 * Returns the UTC Date corresponding to midnight (00:00:00) of `dateIso`
 * in `tz`. Uses noon-UTC as a DST-safe probe — DST transitions happen
 * at 2am local, so noon is always unambiguous.
 *
 * Example: localMidnightUtc("2026-05-22", "America/New_York")
 *          → 2026-05-22T04:00:00.000Z  (EDT = UTC-4)
 */
export function localMidnightUtc(dateIso: string, tz: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const noonUtcMs = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUtcMs));
  const localH = Number(parts.find((p) => p.type === "hour")!.value);
  const localMin = Number(parts.find((p) => p.type === "minute")!.value);
  // UTC offset in ms = (12:00 UTC - local noon). For UTC-4: +4h. For UTC+5: -5h.
  const offsetMs = (12 * 60 - (localH * 60 + localMin)) * 60 * 1000;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + offsetMs);
}

/**
 * Add whole days to a YYYY-MM-DD date string, UTC-safe (no DST drift).
 * Canonical home for the helper that used to be re-implemented in four
 * modules (poll-importer, dashboard-metrics, kiosk pay, admin time).
 */
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "8h 36m" style — ignores values < 1 minute. */
export function formatHoursMinutes(hours: number): string {
  if (!isFinite(hours) || hours <= 0) return "0h";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
