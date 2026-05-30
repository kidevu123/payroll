import type { RawPunchEvent } from "@/lib/ngteco/scraper";

export type PairedPunchEvent =
  | { kind: "complete"; inEv: RawPunchEvent; outEv: RawPunchEvent }
  | { kind: "open"; inEv: RawPunchEvent; outEv: null }
  | { kind: "outOnly"; inEv: null; outEv: RawPunchEvent };

/** NGTeco emits duplicate punch-ins when app + device both fire within seconds. */
export const DUPLICATE_PUNCH_WINDOW_MS = 5 * 60 * 1000;

function localHour(iso: string, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso)),
  );
}

/** Prefer hardware device punches over mobile app duplicates. */
export function punchSourcePriority(source: string): number {
  const s = source.trim().toLowerCase();
  if (!s || s === "app") return 0;
  if (s === "manual") return 1;
  return 2;
}

function classifySingleEvent(
  event: RawPunchEvent,
  timezone: string,
): PairedPunchEvent {
  // NGTeco punch rows do not reliably say "in" vs "out". A lone morning
  // punch is safer as an open shift; a lone afternoon/evening punch is safer
  // as out-only so payroll does not pay from that timestamp forward.
  if (localHour(event.punchAt, timezone) >= 12) {
    return { kind: "outOnly", inEv: null, outEv: event };
  }
  return { kind: "open", inEv: event, outEv: null };
}

/**
 * Walk punch events chronologically instead of pairing by even/odd index.
 * Duplicate punch-ins inside DUPLICATE_PUNCH_WINDOW_MS collapse to one in;
 * the next punch after that window closes the shift.
 */
export function pairPunchEvents(
  events: RawPunchEvent[],
  timezone: string,
): PairedPunchEvent[] {
  const sorted = events
    .slice()
    .sort((a, b) => a.punchAt.localeCompare(b.punchAt));
  if (sorted.length === 0) return [];

  const paired: PairedPunchEvent[] = [];
  let open: RawPunchEvent | null = null;

  for (const ev of sorted) {
    if (open === null) {
      open = ev;
      continue;
    }
    const gapMs =
      new Date(ev.punchAt).getTime() - new Date(open.punchAt).getTime();
    if (gapMs <= DUPLICATE_PUNCH_WINDOW_MS) {
      if (punchSourcePriority(ev.source) > punchSourcePriority(open.source)) {
        open = ev;
      }
      continue;
    }
    paired.push({ kind: "complete", inEv: open, outEv: ev });
    open = null;
  }

  if (open !== null) {
    paired.push(classifySingleEvent(open, timezone));
  }
  return paired;
}
