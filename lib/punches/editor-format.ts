// Formatting and small rules for the admin day editor (punch-editor.tsx):
// datetime-local values, wall-clock labels, the NGTeco source line, and which
// punch needs attention first. Moved out of the editor so they can be tested.
import type { Punch } from "@/lib/db/schema";
import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import { coerceDate, wallClockToUtc } from "@/lib/time/wall-clock";

export function toLocalInputValue(d: Date | string | null, timezone: string): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(coerceDate(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function formatNgtecoSourceLine(notes: string): string {
  const dev = notes.match(/dev:([^\s·]+)/)?.[1];
  const scrape = notes.match(/scrape:([^·]+)/)?.[1];
  const parts = ["From NGTeco time clock"];
  if (dev) parts.push(`device ${dev}`);
  if (scrape) parts.push(`scraped ${scrape.replace(/\|/g, " ")}`);
  return parts.join(" · ");
}

export function formatWallDate(wallClock: string, timezone: string): string {
  const d = wallClockToUtc(wallClock, timezone);
  if (!d) return wallClock.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function defaultClockOutGuess(clockIn: Date | string, timezone: string): string {
  const guess = new Date(coerceDate(clockIn).getTime() + 8 * 60 * 60 * 1000);
  return toLocalInputValue(guess, timezone);
}

/** Punch that needs admin attention first (open shift or missing clock-in). */
export function findFixTarget(punches: Punch[]): Punch | null {
  const active = punches.filter((p) => !p.voidedAt);
  return (
    active.find((p) => isAmbiguousSinglePunch(p)) ??
    active.find((p) => isOpenShiftPunch(p)) ??
    active.find((p) => isMissingClockInPunch(p)) ??
    null
  );
}

export { formatWallClock } from "@/lib/time/format";
