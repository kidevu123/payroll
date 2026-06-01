/** NGTeco out-only row stored with clockIn === clockOut as a sentinel. */
export function isMissingClockInPunch(p: {
  clockIn: Date;
  clockOut: Date | null;
}): boolean {
  return (
    p.clockOut !== null && p.clockIn.getTime() === p.clockOut.getTime()
  );
}

export function isOpenShiftPunch(p: {
  clockIn: Date;
  clockOut: Date | null;
}): boolean {
  return p.clockOut === null && !isMissingClockInPunch(p);
}
