// One way to render a pay-period date range.
//
// This was copy-pasted as a private `formatRange` in the reports table and the
// period detail page, while the /payroll list printed raw ISO dates — so the
// same period read as "Aug 03 – Aug 09, 2026" on one screen and
// "2026-08-03 – 2026-08-09" on the next.

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-08-03", "2026-08-09" -> "Aug 03 – Aug 09, 2026".
 *
 * The year is printed once when both ends share it, and on both ends when the
 * range straddles a year boundary. Dates are parsed at noon UTC so a viewer's
 * timezone can't roll the day backward.
 */
export function formatPeriodRange(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "—";
  const a = new Date(`${startIso}T12:00:00Z`);
  const b = new Date(`${endIso}T12:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return `${startIso} – ${endIso}`;
  }
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${MONTH_SHORT[a.getUTCMonth()]} ${String(a.getUTCDate()).padStart(2, "0")}${
    sameYear ? "" : `, ${a.getUTCFullYear()}`
  }`;
  const right = `${MONTH_SHORT[b.getUTCMonth()]} ${String(b.getUTCDate()).padStart(2, "0")}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}
