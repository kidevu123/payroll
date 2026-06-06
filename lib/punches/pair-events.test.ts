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
  it("treats one morning punch as ambiguous (not assumed clock-in)", () => {
    const pairs = pairPunchEvents(
      [ev("2026-05-23T06:05:00-04:00")],
      "America/New_York",
    );

    expect(pairs).toEqual([
      {
        kind: "ambiguous",
        ev: ev("2026-05-23T06:05:00-04:00"),
      },
    ]);
  });

  it("treats one afternoon punch as ambiguous (not assumed clock-out)", () => {
    const pairs = pairPunchEvents(
      [ev("2026-05-23T17:36:56-04:00")],
      "America/New_York",
    );

    expect(pairs).toEqual([
      {
        kind: "ambiguous",
        ev: ev("2026-05-23T17:36:56-04:00"),
      },
    ]);
  });

  it("pairs complete shifts first and classifies a leftover punch as ambiguous", () => {
    const pairs = pairPunchEvents(
      [
        ev("2026-05-23T06:05:00-04:00"),
        ev("2026-05-23T12:00:00-04:00"),
        ev("2026-05-23T17:36:56-04:00"),
      ],
      "America/New_York",
    );

    expect(pairs.map((p) => p.kind)).toEqual(["complete", "ambiguous"]);
  });

  it("collapses duplicate punch-ins within five minutes into one open shift", () => {
    const appIn = {
      ...ev("2026-05-29T09:07:03-04:00"),
      source: "app",
      verifyType: "Punch",
    };
    const deviceIn = {
      ...ev("2026-05-29T09:07:47-04:00"),
      source: "NMR2241400323",
      verifyType: "Face",
    };
    const deviceOut = {
      ...ev("2026-05-29T18:15:38-04:00"),
      source: "NMR2241400323",
      verifyType: "Face",
    };

    const pairs = pairPunchEvents([appIn, deviceIn, deviceOut], "America/New_York");

    expect(pairs).toEqual([
      {
        kind: "complete",
        inEv: deviceIn,
        outEv: deviceOut,
      },
    ]);
  });

  it("collapses duplicate clock-outs after a complete shift (app + device)", () => {
    const deviceIn = {
      ...ev("2026-06-04T06:17:21-04:00"),
      source: "NMR2241400323",
      verifyType: "Fingerprint",
    };
    const deviceOut = {
      ...ev("2026-06-04T18:17:29-04:00"),
      source: "NMR2241400323",
      verifyType: "Fingerprint",
    };
    const appOut = {
      ...ev("2026-06-04T18:17:35-04:00"),
      source: "app",
      verifyType: "Punch",
    };

    const pairs = pairPunchEvents(
      [deviceIn, deviceOut, appOut],
      "America/New_York",
    );

    expect(pairs).toEqual([
      {
        kind: "complete",
        inEv: deviceIn,
        outEv: deviceOut,
      },
    ]);
  });

  it("still pairs lunch breaks as separate shifts", () => {
    const pairs = pairPunchEvents(
      [
        ev("2026-05-29T09:00:00-04:00"),
        ev("2026-05-29T12:00:00-04:00"),
        ev("2026-05-29T13:00:00-04:00"),
        ev("2026-05-29T18:00:00-04:00"),
      ],
      "America/New_York",
    );

    expect(pairs.map((p) => p.kind)).toEqual(["complete", "complete"]);
  });
});
