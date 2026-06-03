import { describe, expect, it } from "vitest";
import { buildMissedPunchReviewContext } from "./review-context";

const dayKey = () => "2026-06-02";

describe("buildMissedPunchReviewContext", () => {
  it("MISSING_OUT shows open shift clock-in on file and proposed clock-out", () => {
    const clockIn = new Date("2026-06-02T10:08:00.000Z");
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: null,
        claimedClockOut: new Date("2026-06-02T22:09:00.000Z"),
      },
      "MISSING_OUT",
      [
        {
          clockIn,
          clockOut: null,
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );
    expect(ctx.onFileClockIn).toEqual(clockIn);
    expect(ctx.onFileClockOut).toBeNull();
    expect(ctx.proposedClockOut).not.toBeNull();
  });

  it("MISSING_IN shows sentinel clock-out on file", () => {
    const out = new Date("2026-06-02T22:00:00.000Z");
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: new Date("2026-06-02T10:00:00.000Z"),
        claimedClockOut: null,
      },
      "MISSING_IN",
      [
        {
          clockIn: out,
          clockOut: out,
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );
    expect(ctx.onFileClockOut).toEqual(out);
    expect(ctx.proposedClockIn).not.toBeNull();
  });
});
