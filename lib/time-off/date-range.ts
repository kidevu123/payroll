// A time-off request's end date may never be before its start date. The
// server actions already reject that; this is the form-side half, so the
// picker cannot offer an earlier day in the first place.

/** The end date to keep after the start date changes ("YYYY-MM-DD" strings; "" = not chosen yet). */
export function endAfterStartChange(start: string, end: string): string {
  return start && end && end < start ? start : end;
}
