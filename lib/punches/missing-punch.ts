import { wallClockToUtc } from "@/lib/time/wall-clock";

export function isAmbiguousSinglePunch(p: {
  clockIn: Date;
  clockOut: Date | null;
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
  clockIn: Date;
  clockOut: Date | null;
  notes?: string | null;
}): boolean {
  if (isAmbiguousSinglePunch(p)) return false;
  return (
    p.clockOut !== null && p.clockIn.getTime() === p.clockOut.getTime()
  );
}

export function isOpenShiftPunch(p: {
  clockIn: Date;
  clockOut: Date | null;
  notes?: string | null;
}): boolean {
  return (
    p.clockOut === null &&
    !isAmbiguousSinglePunch(p) &&
    !isMissingClockInPunch(p)
  );
}

/** Local hour 0–23 for a stored UTC instant in company timezone. */
export function wallClockHour(d: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(d);
  return Number.parseInt(hour, 10);
}

/**
 * Guess whether a lone NGTeco punch was clock-in or clock-out from time of
 * day. Afternoon/evening punches are usually clock-outs (end of shift).
 */
export function inferAmbiguousOnFileRole(
  punchAt: Date,
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
  onFileAt: Date,
  formatOnFile: (d: Date) => string,
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
