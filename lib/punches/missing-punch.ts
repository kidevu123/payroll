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
