import { isBareWallClock, wallClockToUtc } from "@/lib/time/wall-clock";

export type MissedPunchIssue =
  | "MISSING_IN"
  | "MISSING_OUT"
  | "UNPAIRED_PUNCH"
  | "NO_PUNCH"
  | "SUSPICIOUS_DURATION"
  | "INVERTED_TIMES";

export type MissedPunchClaimInput = {
  claimedClockIn?: string | null | undefined;
  claimedClockOut?: string | null | undefined;
  timezone: string;
  /** When set, only the missing side may be submitted (no duplicate punches). */
  issue?: MissedPunchIssue;
  /**
   * Report date (YYYY-MM-DD). When set, bare time-of-day claims ("17:30",
   * from phone-friendly <input type="time">) are anchored to this date.
   */
  date?: string;
};

const BARE_TIME_RE = /^(\d{2}):(\d{2})(?::\d{2})?$/;

export type MissedPunchClaimResult =
  | { ok: true; clockIn: Date | null; clockOut: Date | null }
  | { ok: false; error: string };

function parseClaimedWallClock(
  value: string | null | undefined,
  timezone: string,
  label: string,
  date?: string,
): Date | null | { error: string } {
  if (!value) return null;
  const timeMatch = value.match(BARE_TIME_RE);
  const wallClock =
    timeMatch && date ? `${date}T${timeMatch[1]}:${timeMatch[2]}` : value;
  const parsed = isBareWallClock(wallClock)
    ? wallClockToUtc(wallClock, timezone)
    : timeMatch
      ? null // bare time without a date to anchor it — nothing to parse
      : new Date(wallClock);
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { error: `Invalid ${label} time.` };
  }
  return parsed;
}

export function parseMissedPunchClaim(
  input: MissedPunchClaimInput,
): MissedPunchClaimResult {
  const clockIn = parseClaimedWallClock(
    input.claimedClockIn,
    input.timezone,
    "clock-in",
    input.date,
  );
  if (clockIn && "error" in clockIn) return { ok: false, error: clockIn.error };

  const clockOut = parseClaimedWallClock(
    input.claimedClockOut,
    input.timezone,
    "clock-out",
    input.date,
  );
  if (clockOut && "error" in clockOut) {
    return { ok: false, error: clockOut.error };
  }

  if (input.issue === "MISSING_OUT") {
    if (clockIn) {
      return {
        ok: false,
        error:
          "Only enter your clock-out time. Your clock-in is already on file from the time clock.",
      };
    }
    if (!clockOut) {
      return { ok: false, error: "Enter the time you clocked out." };
    }
    return { ok: true, clockIn: null, clockOut };
  }

  if (input.issue === "UNPAIRED_PUNCH") {
    if (!clockIn && !clockOut) {
      return {
        ok: false,
        error:
          "Enter the missing punch — either when you clocked in or when you clocked out.",
      };
    }
    if (clockIn && clockOut) {
      return {
        ok: false,
        error:
          "Only enter the one missing punch. The existing punch on file stays attached to the request.",
      };
    }
    return { ok: true, clockIn, clockOut };
  }

  if (input.issue === "MISSING_IN") {
    if (clockOut) {
      return {
        ok: false,
        error:
          "Only enter your clock-in time. Your clock-out is already on file from the time clock.",
      };
    }
    if (!clockIn) {
      return { ok: false, error: "Enter the time you clocked in." };
    }
    return { ok: true, clockIn, clockOut: null };
  }

  if (!clockIn && !clockOut) {
    return { ok: false, error: "Enter at least one corrected punch time." };
  }

  if (clockIn && clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return { ok: false, error: "Clock-out must be after clock-in." };
  }

  return { ok: true, clockIn, clockOut };
}
