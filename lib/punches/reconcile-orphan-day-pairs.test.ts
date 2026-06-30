import { describe, expect, it, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}));

import { reconcileOrphanDayPairs } from "./reconcile-orphan-day-pairs";

function chainSelect(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  selectMock.mockReturnValue(chain);
}

function chainUpdate() {
  const chain = {
    set: () => chain,
    where: () => Promise.resolve(),
  };
  updateMock.mockReturnValue(chain);
}

describe("reconcileOrphanDayPairs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chainUpdate();
  });

  it("merges two ambiguous singles into one complete pair", async () => {
    chainSelect([
      {
        id: "a",
        clockIn: new Date("2026-06-06T10:05:47Z"),
        clockOut: null,
        notes: "ambiguous:single · dev:NMR",
      },
      {
        id: "b",
        clockIn: new Date("2026-06-06T22:00:04Z"),
        clockOut: null,
        notes: "ambiguous:single · dev:NMR",
      },
    ]);

    const voided = await reconcileOrphanDayPairs(
      "emp-1",
      "2026-06-06",
      "America/New_York",
    );

    expect(voided).toBe(1);
    expect(updateMock).toHaveBeenCalled();
  });

  it("leaves a genuine in-progress open shift untouched (no fuse/void)", async () => {
    // The bug: a live 'clocked in, still working' punch (notes 'in:…', NOT
    // ambiguous:single) was treated as a pairable orphan. With an ambiguous
    // single also on the day, the old code stamped a fake clock-out on the live
    // shift and voided the other — destroying real punch data. After the fix the
    // live shift is excluded, so only one orphan remains and nothing happens.
    chainSelect([
      {
        id: "live",
        clockIn: new Date("2026-06-30T11:00:00Z"),
        clockOut: null,
        notes: "in:Fingerprint · dev:NMR2241400323",
      },
      {
        id: "amb",
        clockIn: new Date("2026-06-30T14:15:00Z"),
        clockOut: null,
        notes: "ambiguous:single · dev:NMR",
      },
    ]);

    const voided = await reconcileOrphanDayPairs(
      "emp-1",
      "2026-06-30",
      "America/New_York",
    );

    expect(voided).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does nothing when only one orphan exists", async () => {
    chainSelect([
      {
        id: "a",
        clockIn: new Date("2026-06-06T10:05:47Z"),
        clockOut: null,
        notes: "ambiguous:single",
      },
    ]);

    const voided = await reconcileOrphanDayPairs(
      "emp-1",
      "2026-06-06",
      "America/New_York",
    );
    expect(voided).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
