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

  it("UNPAIRED_PUNCH with claimed clock-in treats the on-file single as clock-out", () => {
    const single = new Date("2026-06-02T22:00:00.000Z");
    const claimedIn = new Date("2026-06-02T12:00:00.000Z");
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: claimedIn,
        claimedClockOut: null,
      },
      "UNPAIRED_PUNCH",
      [
        {
          clockIn: single,
          clockOut: null,
          notes: "ambiguous:single",
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );

    expect(ctx.onFileClockIn).toBeNull();
    expect(ctx.onFileClockOut).toEqual(single);
    expect(ctx.proposedClockIn).toEqual(claimedIn);
  });

  it("alertless claim with an unpaired punch on file infers UNPAIRED_PUNCH", () => {
    // Regression: the ad-hoc report flow files requests without an alert.
    // Approval used to fall through to inserting a brand-new punch,
    // leaving the ambiguous punch unpaired next to a duplicate open punch.
    const single = new Date("2026-06-02T21:37:00.000Z");
    const claimedIn = new Date("2026-06-02T14:00:00.000Z");
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: claimedIn,
        claimedClockOut: null,
      },
      null,
      [
        {
          clockIn: single,
          clockOut: null,
          notes: "ambiguous:single",
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );

    expect(ctx.issue).toBe("UNPAIRED_PUNCH");
    expect(ctx.onFileClockOut).toEqual(single);
    expect(ctx.proposedClockIn).toEqual(claimedIn);
  });

  it("alertless clock-out claim with an unpaired punch on file infers UNPAIRED_PUNCH", () => {
    const single = new Date("2026-06-02T12:00:00.000Z");
    const claimedOut = new Date("2026-06-02T22:00:00.000Z");
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: null,
        claimedClockOut: claimedOut,
      },
      null,
      [
        {
          clockIn: single,
          clockOut: null,
          notes: "ambiguous:single",
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );

    expect(ctx.issue).toBe("UNPAIRED_PUNCH");
    expect(ctx.onFileClockIn).toEqual(single);
    expect(ctx.proposedClockOut).toEqual(claimedOut);
  });

  it("alertless clock-in claim with a sentinel on file infers MISSING_IN", () => {
    const out = new Date("2026-06-02T22:00:00.000Z");
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: new Date("2026-06-02T10:00:00.000Z"),
        claimedClockOut: null,
      },
      null,
      [
        {
          clockIn: out,
          clockOut: out,
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );

    expect(ctx.issue).toBe("MISSING_IN");
    expect(ctx.onFileClockOut).toEqual(out);
  });

  it("alertless clock-out claim with no punches on file stays MISSING_OUT", () => {
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: null,
        claimedClockOut: new Date("2026-06-02T22:00:00.000Z"),
      },
      null,
      [],
      dayKey,
    );

    expect(ctx.issue).toBe("MISSING_OUT");
  });

  it("an explicit alert issue always wins over inference", () => {
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: new Date("2026-06-02T10:00:00.000Z"),
        claimedClockOut: null,
      },
      "MISSING_IN",
      [
        {
          clockIn: new Date("2026-06-02T21:00:00.000Z"),
          clockOut: null,
          notes: "ambiguous:single",
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );

    expect(ctx.issue).toBe("MISSING_IN");
  });

  it("UNPAIRED_PUNCH with claimed clock-out treats the on-file single as clock-in", () => {
    const single = new Date("2026-06-02T12:00:00.000Z");
    const claimedOut = new Date("2026-06-02T22:00:00.000Z");
    const ctx = buildMissedPunchReviewContext(
      {
        date: "2026-06-02",
        claimedClockIn: null,
        claimedClockOut: claimedOut,
      },
      "UNPAIRED_PUNCH",
      [
        {
          clockIn: single,
          clockOut: null,
          notes: "ambiguous:single",
          voidedAt: null,
        } as never,
      ],
      dayKey,
    );

    expect(ctx.onFileClockIn).toEqual(single);
    expect(ctx.onFileClockOut).toBeNull();
    expect(ctx.proposedClockOut).toEqual(claimedOut);
  });
});
