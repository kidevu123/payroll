import { describe, expect, it } from "vitest";
import { makeManualPollJobData } from "./punch-poll-queue";

describe("makeManualPollJobData", () => {
  it("marks manual polls as forced today-only jobs", () => {
    expect(makeManualPollJobData("user-1")).toEqual({
      triggeredBy: "MANUAL",
      triggeredById: "user-1",
      pollOptions: { daysBack: 0, skipAutoBackfill: true },
      force: true,
    });
  });

  it("preserves explicit backfill options", () => {
    expect(makeManualPollJobData("user-1", { daysBack: 7 })).toEqual({
      triggeredBy: "MANUAL",
      triggeredById: "user-1",
      pollOptions: { daysBack: 7, skipAutoBackfill: true },
      force: true,
    });
  });
});
