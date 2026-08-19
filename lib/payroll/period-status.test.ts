import { describe, it, expect } from "vitest";
import {
  resolvePeriodPhase,
  periodProgress,
  PHASE_PRIORITY,
} from "./period-status";

describe("resolvePeriodPhase", () => {
  const week = { startDate: "2026-07-06", endDate: "2026-07-12" };

  it("is RUNNING when today falls inside an OPEN period", () => {
    expect(
      resolvePeriodPhase({ ...week, state: "OPEN", today: "2026-07-08" }),
    ).toBe("RUNNING");
  });

  it("is RUNNING on the boundary days", () => {
    expect(
      resolvePeriodPhase({ ...week, state: "OPEN", today: "2026-07-06" }),
    ).toBe("RUNNING");
    expect(
      resolvePeriodPhase({ ...week, state: "OPEN", today: "2026-07-12" }),
    ).toBe("RUNNING");
  });

  it("is NEEDS_PROCESSING once an OPEN period has ended", () => {
    expect(
      resolvePeriodPhase({ ...week, state: "OPEN", today: "2026-07-13" }),
    ).toBe("NEEDS_PROCESSING");
  });

  it("is UPCOMING before an OPEN period starts", () => {
    expect(
      resolvePeriodPhase({ ...week, state: "OPEN", today: "2026-07-05" }),
    ).toBe("UPCOMING");
  });

  it("is AWAITING_PAYMENT for LOCKED periods regardless of dates", () => {
    expect(
      resolvePeriodPhase({ ...week, state: "LOCKED", today: "2026-07-08" }),
    ).toBe("AWAITING_PAYMENT");
    expect(
      resolvePeriodPhase({ ...week, state: "LOCKED", today: "2026-08-01" }),
    ).toBe("AWAITING_PAYMENT");
  });

  it("prioritizes actionable phases first", () => {
    expect(PHASE_PRIORITY.NEEDS_PROCESSING).toBeLessThan(
      PHASE_PRIORITY.AWAITING_PAYMENT,
    );
    expect(PHASE_PRIORITY.AWAITING_PAYMENT).toBeLessThan(
      PHASE_PRIORITY.RUNNING,
    );
    expect(PHASE_PRIORITY.RUNNING).toBeLessThan(PHASE_PRIORITY.UPCOMING);
  });
});

describe("periodProgress", () => {
  it("counts 1-based days inside the range", () => {
    expect(periodProgress("2026-07-06", "2026-07-12", "2026-07-06")).toEqual({
      day: 1,
      total: 7,
    });
    expect(periodProgress("2026-07-06", "2026-07-12", "2026-07-08")).toEqual({
      day: 3,
      total: 7,
    });
    expect(periodProgress("2026-07-06", "2026-07-12", "2026-07-12")).toEqual({
      day: 7,
      total: 7,
    });
  });

  it("returns null outside the range", () => {
    expect(periodProgress("2026-07-06", "2026-07-12", "2026-07-05")).toBeNull();
    expect(periodProgress("2026-07-06", "2026-07-12", "2026-07-13")).toBeNull();
  });

  it("handles month-crossing semi-monthly ranges", () => {
    expect(periodProgress("2026-06-16", "2026-06-30", "2026-06-30")).toEqual({
      day: 15,
      total: 15,
    });
  });
});
