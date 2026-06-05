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
};

export type MissedPunchClaimResult =
  | { ok: true; clockIn: Date | null; clockOut: Date | null }
  | { ok: false; error: string };

function parseClaimedWallClock(
  value: string | null | undefined,
  timezone: string,
  label: string,
): Date | null | { error: string } {
  if (!value) return null;
  const parsed = isBareWallClock(value)
    ? wallClockToUtc(value, timezone)
    : new Date(value);
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
  );
  if (clockIn && "error" in clockIn) return { ok: false, error: clockIn.error };

  const clockOut = parseClaimedWallClock(
    input.claimedClockOut,
    input.timezone,
    "clock-out",
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
    if (clockIn && clockOut && clockOut.getTime() <= clockIn.getTime()) {
      return { ok: false, error: "Clock-out must be after clock-in." };
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
