import { describe, expect, it } from "vitest";
import {
  findChainedSegmentGroups,
  mergedChainedShiftBounds,
} from "./merge-chained-day-segments";

describe("merge-chained-day-segments", () => {
  it("finds Noelia-style chained fingerprint micro-shifts", () => {
    const rows = [
      {
        id: "a",
        clockIn: new Date("2026-06-09T10:00:00.000Z"),
        clockOut: new Date("2026-06-09T10:05:12.000Z"),
      },
      {
        id: "b",
        clockIn: new Date("2026-06-09T10:05:00.000Z"),
        clockOut: new Date("2026-06-09T22:04:00.000Z"),
      },
      {
        id: "c",
        clockIn: new Date("2026-06-09T22:04:00.000Z"),
        clockOut: new Date("2026-06-09T22:17:00.000Z"),
      },
    ];
    const chains = findChainedSegmentGroups(rows);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(3);
    const merged = mergedChainedShiftBounds(chains[0]!);
    expect(merged.clockIn.toISOString()).toBe("2026-06-09T10:05:00.000Z");
    expect(merged.clockOut.toISOString()).toBe("2026-06-09T22:17:00.000Z");
  });

  it("does not merge shifts separated by a real break", () => {
    const rows = [
      {
        id: "a",
        clockIn: new Date("2026-06-09T10:00:00.000Z"),
        clockOut: new Date("2026-06-09T14:00:00.000Z"),
      },
      {
        id: "b",
        clockIn: new Date("2026-06-09T15:00:00.000Z"),
        clockOut: new Date("2026-06-09T22:00:00.000Z"),
      },
    ];
    expect(findChainedSegmentGroups(rows)).toHaveLength(0);
  });
});
