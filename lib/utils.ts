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
