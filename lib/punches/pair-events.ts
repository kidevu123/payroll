import type { RawPunchEvent } from "@/lib/ngteco/scraper";

export type PairedPunchEvent =
  | { kind: "complete"; inEv: RawPunchEvent; outEv: RawPunchEvent }
  | { kind: "open"; inEv: RawPunchEvent; outEv: null }
  /** @deprecated Legacy afternoon heuristic — importer may still read old rows. */
  | { kind: "outOnly"; inEv: null; outEv: RawPunchEvent }
  /** Lone punch — do not assume clock-in vs clock-out. */
  | { kind: "ambiguous"; ev: RawPunchEvent };

/** NGTeco emits duplicate punch-ins when app + device both fire within seconds. */
export const DUPLICATE_PUNCH_WINDOW_MS = 5 * 60 * 1000;

/** Prefer hardware device punches over mobile app duplicates. */
export function punchSourcePriority(source: string): number {
  const s = source.trim().toLowerCase();
  if (!s || s === "app") return 0;
  if (s === "manual") return 1;
  return 2;
}

function classifySingleEvent(event: RawPunchEvent): PairedPunchEvent {
  // NGTeco does not label in vs out on the punch grid. A single punch might
  // be either side — alert the employee instead of guessing by time of day.
  return { kind: "ambiguous", ev: event };
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
  // Sort by parsed INSTANT, not lexically: punchAt comes in two formats
  // (offset form "…-04:00" and UTC "…Z"), so localeCompare is not chronological
  // and would mis-order clock-in vs clock-out across mixed formats / DST.
  const sorted = events
    .slice()
    .sort((a, b) => new Date(a.punchAt).getTime() - new Date(b.punchAt).getTime());
  if (sorted.length === 0) return [];

  const paired: PairedPunchEvent[] = [];
  let open: RawPunchEvent | null = null;
  /** Last clock-out that closed a complete shift (for app+device dup outs). */
  let lastOutEv: RawPunchEvent | null = null;

  for (const ev of sorted) {
    if (open === null) {
      // NGTeco often fires app + device clock-outs within seconds. The first
      // out already closed the shift; treat the second as a duplicate, not
      // a new ambiguous single (was creating false "unpaired punch" rows).
      if (lastOutEv !== null) {
        const gapFromLastOut =
          new Date(ev.punchAt).getTime() -
          new Date(lastOutEv.punchAt).getTime();
        if (gapFromLastOut <= DUPLICATE_PUNCH_WINDOW_MS) {
          if (
            punchSourcePriority(ev.source) >
            punchSourcePriority(lastOutEv.source)
          ) {
            const last = paired[paired.length - 1];
            if (last?.kind === "complete") {
              last.outEv = ev;
            }
            lastOutEv = ev;
          }
          continue;
        }
      }
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
    lastOutEv = ev;
    open = null;
  }

  if (open !== null) {
    paired.push(classifySingleEvent(open));
  }
  return paired;
}
