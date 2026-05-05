// Wall-clock <-> UTC conversion. The admin punch editor uses
// <input type="datetime-local"> which submits values like
// "2026-05-04T20:00" with NO timezone offset. `new Date(string)` on a
// bare wall-clock interprets it as the JS runtime's local timezone —
// which on the LXC is UTC, so an admin entering "8 PM" was landing
// the punch as 8 PM UTC = 4 PM ET. Owner directive: everything is ET.
// This helper parses a wall-clock string AS IF it were
// `company.timezone` and returns the correct UTC Date.

const ISO_WALL_CLOCK_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parse "YYYY-MM-DDTHH:mm[:ss]" as a wall-clock in `tz` (e.g.
 * "America/New_York") and return the corresponding UTC Date.
 * Returns null when the input doesn't match the wall-clock shape.
 *
 * Algorithm:
 *   1. Treat the input as if it were UTC -> a "candidate" Date.
 *   2. Format that candidate Date back into `tz` -> what the wall
 *      clock would read in `tz` for that moment.
 *   3. The diff between the input wall-clock and (2) IS the offset
 *      between UTC and `tz` at that moment. Apply it.
 *
 * Works across DST transitions because step (2) uses the runtime's
 * timezone database, not a fixed offset.
 */
export function wallClockToUtc(wallClock: string, tz: string): Date | null {
  const m = wallClock.match(ISO_WALL_CLOCK_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const candidate = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}Z`);
  if (Number.isNaN(candidate.getTime())) return null;
  // What does `tz` say the wall clock reads at `candidate`?
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(candidate);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const tzWallStr = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`;
  const tzWall = new Date(tzWallStr);
  if (Number.isNaN(tzWall.getTime())) return null;
  const offsetMs = candidate.getTime() - tzWall.getTime();
  return new Date(candidate.getTime() + offsetMs);
}

/**
 * Strip a fully-qualified ISO string with offset (Auth.js / browser
 * provides these via JS pickers in some flows) — when the string
 * already carries an offset, `new Date()` parses it correctly. Use
 * this helper only for bare datetime-local inputs.
 */
export function isBareWallClock(s: string): boolean {
  return ISO_WALL_CLOCK_RE.test(s);
}
