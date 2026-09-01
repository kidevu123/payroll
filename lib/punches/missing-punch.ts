import { coerceDate, wallClockToUtc } from "@/lib/time/wall-clock";

export function isAmbiguousSinglePunch(p: {
  clockIn: Date | string;
  clockOut: Date | string | null;
  notes?: string | null;
}): boolean {
  return (
    p.clockOut === null &&
    typeof p.notes === "string" &&
    p.notes.includes("ambiguous:single")
  );
}

/** Legacy out-only row stored with clockIn === clockOut as a sentinel. */
export function isMissingClockInPunch(p: {
  clockIn: Date | string;
  clockOut: Date | string | null;
  notes?: string | null;
}): boolean {
  if (isAmbiguousSinglePunch(p)) return false;
  if (p.clockOut === null) return false;
  return (
    coerceDate(p.clockIn).getTime() === coerceDate(p.clockOut).getTime()
  );
}

export function isOpenShiftPunch(p: {
  clockIn: Date | string;
  clockOut: Date | string | null;
  notes?: string | null;
}): boolean {
  return (
    p.clockOut === null &&
    !isAmbiguousSinglePunch(p) &&
    !isMissingClockInPunch(p)
  );
}

/** Local hour 0–23 for a stored UTC instant in company timezone. */
export function wallClockHour(d: Date | string, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(coerceDate(d));
  return Number.parseInt(hour, 10);
}

/**
 * Guess whether a lone NGTeco punch was clock-in or clock-out from time of
 * day. Afternoon/evening punches are usually clock-outs (end of shift).
 */
export function inferAmbiguousOnFileRole(
  punchAt: Date | string,
  timezone: string,
): "clock-in" | "clock-out" {
  return wallClockHour(punchAt, timezone) >= 14 ? "clock-out" : "clock-in";
}

/** Validate admin input when resolving an ambiguous:single punch. */
export function validateAmbiguousPair(
  onFileRole: "clock-in" | "clock-out",
  onFileWallClock: string,
  missingWallClock: string,
  timezone: string,
  onFileAt: Date | string,
  formatOnFile: (d: Date | string) => string,
): string | null {
  const onFileUtc = wallClockToUtc(onFileWallClock, timezone);
  const missingUtc = wallClockToUtc(missingWallClock, timezone);
  if (!onFileUtc || !missingUtc) return "Invalid time — check the date and time.";

  const onFileLabel = formatOnFile(onFileAt);

  if (onFileRole === "clock-in") {
    if (missingUtc.getTime() <= onFileUtc.getTime()) {
      return `Clock-out must be after the on-file punch (${onFileLabel}). If ${onFileLabel} was when they left, select Clock out and enter when they arrived.`;
    }
    return null;
  }

  if (missingUtc.getTime() >= onFileUtc.getTime()) {
    return `Clock-in must be before the on-file punch (${onFileLabel}). If ${onFileLabel} was when they arrived, select Clock in and enter when they left.`;
  }
  return null;
}

const WALL_CLOCK_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_ONLY_RE = /^(\d{2}):(\d{2})$/;

/**
 * Build the full wall-clock value for the missing side of an ambiguous
 * punch from a time-only input. The date is taken from the on-file punch
 * so the admin never re-types a date the app already knows. It rolls to
 * the adjacent day only when the entered time makes that the sole valid
 * reading (overnight shift): a clock-out at or before the on-file
 * clock-in time is treated as next day; a clock-in at or after the
 * on-file clock-out time is treated as the previous day.
 */
export function composeMissingWallClock(
  onFileRole: "clock-in" | "clock-out",
  onFileWallClock: string,
  missingTime: string,
): { wallClock: string; dayOffset: -1 | 0 | 1 } | null {
  const dateMatch = WALL_CLOCK_DATE_RE.exec(onFileWallClock);
  const timeMatch = TIME_ONLY_RE.exec(missingTime);
  if (!dateMatch || !timeMatch) return null;

  const [, y, mo, d, onH, onM] = dateMatch;
  const [, h, m] = timeMatch;
  const onFileMinutes = Number(onH) * 60 + Number(onM);
  const missingMinutes = Number(h) * 60 + Number(m);

  const dayOffset: -1 | 0 | 1 =
    onFileRole === "clock-in"
      ? missingMinutes <= onFileMinutes
        ? 1
        : 0
      : missingMinutes >= onFileMinutes
        ? -1
        : 0;

  // Date-only arithmetic in UTC so DST never shifts the calendar day.
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + dayOffset));
  const wallDate = day.toISOString().slice(0, 10);
  return { wallClock: `${wallDate}T${h}:${m}`, dayOffset };
}
