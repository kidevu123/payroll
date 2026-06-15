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
