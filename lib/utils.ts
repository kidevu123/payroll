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
