// Pure helpers behind the admin employee page: the figures in the summary
// strip, readable dates, and the notes timeline. No database access here.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2025-01-01" -> "Jan 1, 2025". Parsed as a calendar date, never shifted. */
export function formatIsoDate(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

const MS_PER_DAY = 86_400_000;

/** How long someone has worked here as of `todayIso`: "1 yr 9 mo", "2 mo", "8 days". */
export function formatTenure(hiredOnIso: string, todayIso: string): string {
  if (!ISO_DATE.test(hiredOnIso) || !ISO_DATE.test(todayIso)) return "—";
  const [hy, hm, hd] = hiredOnIso.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = todayIso.split("-").map(Number) as [number, number, number];
  const days = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(hy, hm - 1, hd)) / MS_PER_DAY,
  );
  if (days < 0) return "Not started";
  if (days === 0) return "Starts today";
  const months = (ty - hy) * 12 + (tm - hm) - (td < hd ? 1 : 0);
  if (months < 1) return days === 1 ? "1 day" : `${days} days`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} mo`;
  return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`;
}

export type PaySummaryInput = {
  periodStart: string;
  periodEnd: string;
  payCents: number;
  hours: number;
};

export type PaySummary<T extends PaySummaryInput> = {
  year: number;
  /** Most recent payslip with pay on it; empty weeks are skipped. */
  lastPaid: T | null;
  ytdPayCents: number;
  ytdHours: number;
  /** Payslips this year that paid something. */
  ytdPaidCount: number;
};

/**
 * Year-to-date totals and the last real paycheck. A payslip belongs to the
 * year its period ENDS in, matching how the period is labelled everywhere.
 */
export function summarizePay<T extends PaySummaryInput>(
  slips: readonly T[],
  todayIso: string,
): PaySummary<T> {
  const year = Number(todayIso.slice(0, 4));
  const paid = slips.filter((s) => s.payCents > 0);
  const thisYear = slips.filter((s) => Number(s.periodEnd.slice(0, 4)) === year);
  const lastPaid = paid.reduce<T | null>(
    (latest, s) => (latest === null || s.periodEnd > latest.periodEnd ? s : latest),
    null,
  );
  return {
    year,
    lastPaid,
    ytdPayCents: thisYear.reduce((sum, s) => sum + s.payCents, 0),
    ytdHours: thisYear.reduce((sum, s) => sum + s.hours, 0),
    ytdPaidCount: thisYear.filter((s) => s.payCents > 0).length,
  };
}

export type NoteEntry = { at: Date | null; text: string };

const STAMPED_LINE = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s*(.*)$/;

/**
 * Employee notes are free text plus lines the system appends as
 * "[ISO timestamp] what happened" (terminated, reinstated). Split them so the
 * page can show a dated timeline instead of raw timestamps. Consecutive
 * free-text lines stay together as one undated entry.
 */
export function parseEmployeeNotes(notes: string | null | undefined): NoteEntry[] {
  if (!notes) return [];
  const entries: NoteEntry[] = [];
  let free: string[] = [];
  const flushFree = () => {
    if (free.length > 0) entries.push({ at: null, text: free.join("\n") });
    free = [];
  };
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = STAMPED_LINE.exec(line);
    const at = match?.[1] ? new Date(match[1]) : null;
    if (match && at && !Number.isNaN(at.getTime())) {
      flushFree();
      entries.push({ at, text: match[2] ?? "" });
    } else {
      free.push(line);
    }
  }
  flushFree();
  return entries;
}

/**
 * Turn a system note into a headline and optional detail:
 * "terminated: left for school" -> { title: "Terminated", detail: "left for school" }.
 * A reason that only repeats the event ("terminated: terminated") is dropped.
 */
export function describeNote(text: string): { title: string; detail: string | null } {
  const trimmed = text.trim();
  const match = /^(terminated|reinstated)(?::\s*(.*))?$/i.exec(trimmed);
  if (!match?.[1]) return { title: trimmed, detail: null };
  const event = match[1].toLowerCase();
  const title = event.charAt(0).toUpperCase() + event.slice(1);
  const detail = match[2]?.trim() ?? "";
  return {
    title,
    detail: detail && detail.toLowerCase() !== event ? detail : null,
  };
}
