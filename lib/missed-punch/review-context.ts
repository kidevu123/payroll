import type { MissedPunchRequest, Punch } from "@/lib/db/schema";
import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import type { MissedPunchIssue } from "./claim";

export type MissedPunchReviewContext = {
  issue: MissedPunchIssue | null;
  onFileClockIn: Date | null;
  onFileClockOut: Date | null;
  proposedClockIn: Date | null;
  proposedClockOut: Date | null;
};

export function inferMissedPunchIssue(
  issue: MissedPunchIssue | null | undefined,
  request: Pick<
    MissedPunchRequest,
    "claimedClockIn" | "claimedClockOut"
  >,
): MissedPunchIssue | null {
  if (issue) return issue;
  if (request.claimedClockOut && !request.claimedClockIn) return "MISSING_OUT";
  if (request.claimedClockIn && !request.claimedClockOut) return "MISSING_IN";
  return null;
}

/** Resolve on-file vs proposed times for admin approval UI. */
export function buildMissedPunchReviewContext(
  request: Pick<
    MissedPunchRequest,
    "date" | "claimedClockIn" | "claimedClockOut"
  >,
  issue: MissedPunchIssue | null | undefined,
  dayPunches: Punch[],
  dayKey: (d: Date) => string,
): MissedPunchReviewContext {
  const effectiveIssue = inferMissedPunchIssue(issue, request);
  const forDay = dayPunches.filter(
    (p) => !p.voidedAt && dayKey(p.clockIn) === request.date,
  );

  let onFileClockIn: Date | null = null;
  let onFileClockOut: Date | null = null;

  if (effectiveIssue === "MISSING_OUT") {
    const open = forDay.find((p) => isOpenShiftPunch(p));
    if (open) onFileClockIn = open.clockIn;
  } else if (effectiveIssue === "UNPAIRED_PUNCH") {
    const unpaired = forDay.find((p) => isAmbiguousSinglePunch(p));
    if (unpaired) {
      if (request.claimedClockIn && !request.claimedClockOut) {
        onFileClockOut = unpaired.clockIn;
      } else {
        onFileClockIn = unpaired.clockIn;
      }
    }
  } else if (effectiveIssue === "MISSING_IN") {
    const sentinel = forDay.find((p) => isMissingClockInPunch(p));
    if (sentinel?.clockOut) onFileClockOut = sentinel.clockOut;
  }

  return {
    issue: effectiveIssue,
    onFileClockIn,
    onFileClockOut,
    proposedClockIn: request.claimedClockIn,
    proposedClockOut: request.claimedClockOut,
  };
}
