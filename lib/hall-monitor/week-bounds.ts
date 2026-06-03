const MS_PER_DAY = 86_400_000;

/** Most recent Sunday (inclusive) on or before `todayIso` in company TZ. */
export function weekEndingSunday(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dow = utc.getUTCDay();
  const end = new Date(utc.getTime() - dow * MS_PER_DAY);
  return formatIso(end);
}

export function weekStartFromEnd(weekEndIso: string): string {
  const [y, m, d] = weekEndIso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end.getTime() - 6 * MS_PER_DAY);
  return formatIso(start);
}

function formatIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}
