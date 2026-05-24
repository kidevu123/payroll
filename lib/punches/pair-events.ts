import type { RawPunchEvent } from "@/lib/ngteco/scraper";

export type PairedPunchEvent =
  | { kind: "complete"; inEv: RawPunchEvent; outEv: RawPunchEvent }
  | { kind: "open"; inEv: RawPunchEvent; outEv: null }
  | { kind: "outOnly"; inEv: null; outEv: RawPunchEvent };

function localHour(iso: string, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso)),
  );
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

export function pairPunchEvents(
  events: RawPunchEvent[],
  timezone: string,
): PairedPunchEvent[] {
  const sorted = events
    .slice()
    .sort((a, b) => a.punchAt.localeCompare(b.punchAt));
  const paired: PairedPunchEvent[] = [];
  for (let i = 0; i < sorted.length; i += 2) {
    const inEv = sorted[i]!;
    const outEv = sorted[i + 1] ?? null;
    if (outEv) {
      paired.push({ kind: "complete", inEv, outEv });
    } else {
      paired.push(classifySingleEvent(inEv, timezone));
    }
  }
  return paired;
}
