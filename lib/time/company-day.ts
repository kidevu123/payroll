// The canonical "what calendar day is this instant, in the company timezone"
// helper. en-CA + an explicit Y/M/D format yields a stable "YYYY-MM-DD" key
// regardless of locale. Use this everywhere instead of re-typing the
// Intl.DateTimeFormat("en-CA", { timeZone }) incantation inline.
export function companyDayIso(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Alias kept for existing callers — "today" is just the company day of `now`. */
export function companyTodayIso(now: Date, timeZone: string): string {
  return companyDayIso(now, timeZone);
}
