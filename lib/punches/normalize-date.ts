// Best-effort read of a date cell from an uploaded punch CSV: ISO or US
// m/d/y, as YYYY-MM-DD. Used to guess the pay period a file covers.
export function normalizeDateForGuess(s: string): string | null {
  const trimmed = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed);
  if (us) {
    const m = us[1]!.padStart(2, "0");
    const d = us[2]!.padStart(2, "0");
    const y = us[3]!.length === 2 ? `20${us[3]}` : us[3]!;
    return `${y}-${m}-${d}`;
  }
  return null;
}
