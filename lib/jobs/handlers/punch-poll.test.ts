import { describe, expect, it } from "vitest";
import { shouldSuppressMissedPunchSyncAfterPoll } from "./punch-poll";

describe("shouldSuppressMissedPunchSyncAfterPoll", () => {
  it("suppresses employee missed-punch sync for a partial evening scrape of only ambiguous singles", () => {
    expect(
      shouldSuppressMissedPunchSyncAfterPoll(
        {
          completePairs: 0,
          missingClockIn: 0,
          openShifts: 0,
          pairsUpdated: 0,
          unpairedPunches: 20,
        },
        20,
      ),
    ).toBe(true);
  });

  it("allows sync when the poll has complete paired punches", () => {
    expect(
      shouldSuppressMissedPunchSyncAfterPoll(
        {
          completePairs: 19,
          missingClockIn: 0,
          openShifts: 0,
          pairsUpdated: 0,
          unpairedPunches: 1,
        },
        20,
      ),
    ).toBe(false);
  });

  it("allows sync before close time so stale alerts can still resolve without new same-day notices", () => {
    expect(
      shouldSuppressMissedPunchSyncAfterPoll(
        {
          completePairs: 0,
          missingClockIn: 0,
          openShifts: 0,
          pairsUpdated: 0,
          unpairedPunches: 20,
        },
        18,
      ),
    ).toBe(false);
  });
});
