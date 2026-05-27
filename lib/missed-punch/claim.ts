import { isBareWallClock, wallClockToUtc } from "@/lib/time/wall-clock";

export type MissedPunchClaimInput = {
  claimedClockIn?: string | null | undefined;
  claimedClockOut?: string | null | undefined;
  timezone: string;
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

  if (!clockIn && !clockOut) {
    return { ok: false, error: "Enter at least one corrected punch time." };
  }

  if (clockIn && clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return { ok: false, error: "Clock-out must be after clock-in." };
  }

  return { ok: true, clockIn, clockOut };
}
