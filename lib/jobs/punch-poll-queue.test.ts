import { describe, expect, it } from "vitest";
import { makeManualPollJobData } from "./punch-poll-queue";

describe("makeManualPollJobData", () => {
  it("marks manual polls as forced background jobs", () => {
    expect(makeManualPollJobData("user-1")).toEqual({
      triggeredBy: "MANUAL",
      triggeredById: "user-1",
      force: true,
    });
  });

  it("preserves backfill options", () => {
    expect(makeManualPollJobData("user-1", { daysBack: 7 })).toEqual({
      triggeredBy: "MANUAL",
      triggeredById: "user-1",
      pollOptions: { daysBack: 7 },
      force: true,
    });
  });
});
