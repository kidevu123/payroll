import { describe, expect, it } from "vitest";
import { localDayBoundsForPollImport } from "./poll-importer";

describe("localDayBoundsForPollImport", () => {
  it("uses company-local midnight bounds, not UTC-midnight bounds", () => {
    const { dayStart, dayEnd } = localDayBoundsForPollImport(
      "2026-06-02",
      "America/New_York",
    );

    expect(dayStart.toISOString()).toBe("2026-06-02T04:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-06-03T04:00:00.000Z");
    expect(new Date("2026-06-03T01:30:00.000Z") >= dayStart).toBe(true);
    expect(new Date("2026-06-03T01:30:00.000Z") < dayEnd).toBe(true);
  });
});
