// Back pay: a shift reported AFTER its week was already paid is recorded
// with its true timestamps but attached to the employee's CURRENT pay
// period, so the money flows into the next run without reopening paid
// history. The punch carries a machine-readable note tag naming the day
// actually worked; display surfaces use it to label the row.
//
// This is the deliberate, audited exception to the "punch must fall
// inside its period's date range" guard (assertPunchWithinPeriod) —
// that guard prevents accidental cross-period bleed, back pay is an
// explicit owner-approved carryover.

const BACKPAY_NOTE_RE = /\bbackpay:(\d{4}-\d{2}-\d{2})\b/;

export function isBackPayPunch(p: { notes?: string | null }): boolean {
  return typeof p.notes === "string" && BACKPAY_NOTE_RE.test(p.notes);
}

/** The day actually worked (YYYY-MM-DD), or null when not a back-pay punch. */
export function backPayWorkDate(notes: string | null | undefined): string | null {
  if (!notes) return null;
  return notes.match(BACKPAY_NOTE_RE)?.[1] ?? null;
}

/** Compose the notes line for a back-pay punch. */
export function backPayNote(workDate: string, detail: string): string {
  return `backpay:${workDate} Worked ${workDate} — that week was already paid; paying in the current period. ${detail}`.trim();
}
