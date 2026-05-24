import { describe, expect, it } from "vitest";
import { pairPunchEvents } from "./pair-events";
import type { RawPunchEvent } from "@/lib/ngteco/scraper";

function ev(punchAt: string): RawPunchEvent {
  return {
    personId: "29",
    personName: "Claudia Alvarado",
    punchAt,
    verifyType: "Punch",
    source: "app",
  };
}

describe("pairPunchEvents", () => {
  it("treats one morning punch as an open shift missing clock-out", () => {
    const pairs = pairPunchEvents(
      [ev("2026-05-23T06:05:00-04:00")],
      "America/New_York",
    );

    expect(pairs).toEqual([
      {
        kind: "open",
        inEv: ev("2026-05-23T06:05:00-04:00"),
        outEv: null,
      },
    ]);
  });

  it("treats one late-day punch as out-only so Milo asks for the missing clock-in", () => {
    const pairs = pairPunchEvents(
      [ev("2026-05-23T17:36:56-04:00")],
      "America/New_York",
    );

    expect(pairs).toEqual([
      {
        kind: "outOnly",
        inEv: null,
        outEv: ev("2026-05-23T17:36:56-04:00"),
      },
    ]);
  });

  it("pairs complete shifts first and classifies a leftover late punch as out-only", () => {
    const pairs = pairPunchEvents(
      [
        ev("2026-05-23T06:05:00-04:00"),
        ev("2026-05-23T12:00:00-04:00"),
        ev("2026-05-23T17:36:56-04:00"),
      ],
      "America/New_York",
    );

    expect(pairs.map((p) => p.kind)).toEqual(["complete", "outOnly"]);
  });
});
