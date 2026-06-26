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
  // Offset (UTC minus what `tz`'s wall clock reads) AT a given instant.
  const offsetAt = (instantMs: number): number | null => {
    const parts = fmt.formatToParts(new Date(instantMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const tzWall = new Date(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    if (Number.isNaN(tzWall.getTime())) return null;
    return instantMs - tzWall.getTime();
  };
  // Evaluate the offset at the TARGET instant, not at the candidate. On DST
  // transition days the offset at the candidate (wall-clock-as-UTC) differs
  // from the offset at the real instant, which left punches an hour off. One
  // re-evaluation converges across the spring-forward gap / fall-back overlap.
  const off1 = offsetAt(candidate.getTime());
  if (off1 === null) return null;
  const off2 = offsetAt(candidate.getTime() + off1);
  if (off2 === null) return null;
  return new Date(candidate.getTime() + off2);
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

/** RSC serializes Date props to ISO strings before client hydration. */
export function coerceDate(d: Date | string): Date {
  if (d instanceof Date) return d;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date: ${String(d)}`);
  }
  return parsed;
}
