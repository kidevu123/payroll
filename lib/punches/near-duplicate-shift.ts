// Shared near-duplicate shift detection for poll import, auto-merge, and repair.

import { DUPLICATE_PUNCH_WINDOW_MS } from "./pair-events";

export type ShiftTimes = {
  clockIn: Date;
  clockOut: Date | null;
};

function asMs(d: Date): number {
  return d.getTime();
}

function inMinute(d: Date): number {
  return Math.floor(asMs(d) / 60_000);
}

/**
 * True when two closed shifts describe the same physical work block.
 * Catches rescrape IN skew (seconds apart), poll vs CSV minute rounding,
 * and device+app double-fire with identical out times.
 */
export function shiftsAreNearDuplicates(
  a: ShiftTimes,
  b: ShiftTimes,
  windowMs: number = DUPLICATE_PUNCH_WINDOW_MS,
): boolean {
  if (!a.clockOut || !b.clockOut) return false;
  const inDelta = Math.abs(asMs(a.clockIn) - asMs(b.clockIn));
  const outDelta = Math.abs(asMs(a.clockOut) - asMs(b.clockOut));
  if (inDelta <= windowMs && outDelta <= windowMs) return true;
  return (
    inMinute(a.clockIn) === inMinute(b.clockIn) &&
    inMinute(a.clockOut) === inMinute(b.clockOut)
  );
}

export type RankableShift = ShiftTimes & { id: string };

/** Same survivor rules as dedupNearDuplicatePunches / mergeDuplicatePunches. */
export function rankShiftsBySurvivor<T extends RankableShift>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aClosed = a.clockOut ? 1 : 0;
    const bClosed = b.clockOut ? 1 : 0;
    if (aClosed !== bClosed) return bClosed - aClosed;
    const aDur = a.clockOut
      ? asMs(a.clockOut) - asMs(a.clockIn)
      : 0;
    const bDur = b.clockOut
      ? asMs(b.clockOut) - asMs(b.clockIn)
      : 0;
    if (aDur !== bDur) return bDur - aDur;
    return a.id.localeCompare(b.id);
  });
}

export function minuteClusterKey(row: ShiftTimes & { employeeId?: string }): string {
  const outMin = row.clockOut ? inMinute(row.clockOut) : -1;
  const emp = row.employeeId ?? "";
  return `${emp}|${inMinute(row.clockIn)}|${outMin}`;
}
