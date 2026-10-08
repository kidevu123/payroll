
// Which pay period the /time grid shows, as pure rules. The database side
// (lib/db/queries/time-grid.ts) finds candidate rows; these functions decide.
export type PeriodKind = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";

export type PeriodView = {
  /** Real DB id, or "" for a synthetic forward-rolled window. */
  id: string;
  startDate: string;
  endDate: string;
  payScheduleId: string | null;
  /** Display-only label about the period's underlying state. */
  state: "OPEN" | "LOCKED" | "PAID" | "UPCOMING";
};

/**
 * The window that immediately follows `prevEnd` for a cadence: the next 7
 * (or 14) days for weekly/biweekly, the next full calendar month otherwise.
 */
export function nextWindowAfter(prevEnd: string, kind: PeriodKind): { start: string; end: string } {
  const startDate = new Date(`${prevEnd}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  if (kind === "WEEKLY" || kind === "BIWEEKLY") {
    const end = new Date(startDate);
    end.setUTCDate(end.getUTCDate() + (kind === "WEEKLY" ? 6 : 13));
    return { start: startDate.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const start = new Date(startDate);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() + 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Owner's mental model: "if last week is locked, move on". A most-recent
 * period that is OPEN, or that still covers today, is shown; otherwise the
 * grid rolls forward to the next synthetic window (id "") so the admin sees
 * the live week instead of the closed one.
 */
export function resolveFromMostRecent(
  mostRecent: { id: string; startDate: string; endDate: string; payScheduleId: string | null; state: "OPEN" | "LOCKED" | "PAID"; kind: PeriodKind | null },
  today: string,
  kindFilter: PeriodKind | null,
): PeriodView {
  if (mostRecent.state === "OPEN" || mostRecent.endDate >= today) {
    return { id: mostRecent.id, startDate: mostRecent.startDate, endDate: mostRecent.endDate, payScheduleId: mostRecent.payScheduleId, state: mostRecent.state };
  }
  const next = nextWindowAfter(mostRecent.endDate, kindFilter ?? mostRecent.kind ?? "WEEKLY");
  return { id: "", startDate: next.start, endDate: next.end, payScheduleId: mostRecent.payScheduleId, state: "UPCOMING" };
}

/**
 * The grid always renders a full Monday->Sunday week even when the stored
 * period is shorter (the owner sometimes pulls punches early).
 */
export function gridLastDay(period: { startDate: string; endDate: string }): string {
  const start = new Date(`${period.startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 6);
  const canonicalEnd = start.toISOString().slice(0, 10);
  return period.endDate < canonicalEnd ? canonicalEnd : period.endDate;
}
