import { describe, expect, it } from "vitest";
import {
  localDayBoundsForPollImport,
  isAdminTouchedPunch,
} from "./poll-importer";

describe("isAdminTouchedPunch (poll must not revert admin changes)", () => {
  it("treats a deleted punch as admin-touched so the poll can't resurrect it", () => {
    expect(
      isAdminTouchedPunch({ voidedAt: new Date(), editedAt: new Date() }),
    ).toBe(true);
  });

  it("treats an edited punch as admin-touched so the poll can't overwrite its times", () => {
    expect(isAdminTouchedPunch({ voidedAt: null, editedAt: new Date() })).toBe(
      true,
    );
  });

  it("leaves an untouched auto-imported punch open to normal poll updates", () => {
    expect(isAdminTouchedPunch({ voidedAt: null, editedAt: null })).toBe(false);
  });
});

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
