import type { MissedPunchRequest, Punch } from "@/lib/db/schema";
import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import type { MissedPunchIssue } from "./claim";
import { soleClosedPunchOnDay } from "@/lib/punches/approve-missed-punch-guards";

export type MissedPunchReviewContext = {
  issue: MissedPunchIssue | null;
  onFileClockIn: Date | null;
  onFileClockOut: Date | null;
  proposedClockIn: Date | null;
  proposedClockOut: Date | null;
  /**
   * True when the request corrects a day that already has one completed
   * shift: approving REPLACES the times on file with the proposed ones
   * (everywhere else the proposed time fills a gap next to what is on file).
   */
  replacesOnFile: boolean;
};

export function inferMissedPunchIssue(
  issue: MissedPunchIssue | null | undefined,
  request: Pick<
    MissedPunchRequest,
    "claimedClockIn" | "claimedClockOut"
  >,
  forDayPunches?: Array<
    Pick<Punch, "clockIn" | "clockOut"> & { notes?: string | null }
  >,
): MissedPunchIssue | null {
  if (issue) return issue;
  const inOnly = Boolean(request.claimedClockIn) && !request.claimedClockOut;
  const outOnly = Boolean(request.claimedClockOut) && !request.claimedClockIn;
  // Ad-hoc reports carry no alert, but the punches on file for the day still
  // say what is being fixed. A single-sided claim against an ambiguous
  // unpaired punch must resolve THAT punch — otherwise approval falls
  // through to inserting a duplicate and the unpaired punch stays behind.
  if (inOnly || outOnly) {
    if (forDayPunches?.some((p) => isAmbiguousSinglePunch(p))) {
      return "UNPAIRED_PUNCH";
    }
    if (inOnly && forDayPunches?.some((p) => isMissingClockInPunch(p))) {
      return "MISSING_IN";
    }
  }
  if (outOnly) return "MISSING_OUT";
  if (inOnly) return "MISSING_IN";
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
  const forDay = dayPunches.filter(
    (p) => !p.voidedAt && dayKey(p.clockIn) === request.date,
  );
  const effectiveIssue = inferMissedPunchIssue(issue, request, forDay);

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

  // A full in/out claim against a day with one completed shift is a
  // correction of that shift, so show the reviewer what it replaces.
  let replacesOnFile = false;
  if (!effectiveIssue && request.claimedClockIn && request.claimedClockOut) {
    const existing = soleClosedPunchOnDay(forDay);
    if (existing) {
      onFileClockIn = existing.clockIn;
      onFileClockOut = existing.clockOut;
      replacesOnFile = true;
    }
  }

  return {
    issue: effectiveIssue,
    onFileClockIn,
    onFileClockOut,
    proposedClockIn: request.claimedClockIn,
    proposedClockOut: request.claimedClockOut,
    replacesOnFile,
  };
}
