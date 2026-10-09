import { beforeEach, describe, expect, it, vi } from "vitest";

// One queue of result sets for tx.select(), consumed in call order, and a
// record of every tx.update().set() payload so the test can assert on writes.
const selectResults: unknown[][] = [];
const updateSets: Record<string, unknown>[] = [];
const updateReturns: unknown[][] = [];
const writeAuditMock = vi.fn();

const tx = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(selectResults.shift() ?? []),
    }),
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      updateSets.push(values);
      const rows = updateReturns.shift() ?? [];
      return {
        where: () =>
          Object.assign(Promise.resolve(rows), {
            returning: () => Promise.resolve(rows),
          }),
      };
    },
  }),
};

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

vi.mock("@/lib/db/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAuditMock(...args),
}));

import { reinstateEmployee, reinstatedStatus } from "./employees";

const ACTOR = { id: "admin-1", role: "OWNER" as const };

function terminated(overrides: Record<string, unknown> = {}) {
  return {
    id: "emp-1",
    status: "TERMINATED",
    payType: "HOURLY",
    payScheduleId: "sched-1",
    hourlyRateCents: 1300,
    notes: "[2026-09-09T15:36:36.546Z] terminated: terminated",
    ...overrides,
  };
}

describe("reinstatedStatus", () => {
  it("returns ACTIVE when the employee is ready to be paid", () => {
    expect(
      reinstatedStatus({
        payType: "HOURLY",
        payScheduleId: "sched-1",
        hourlyRateCents: 1300,
      }),
    ).toBe("ACTIVE");
  });

  it("returns INACTIVE when an hourly employee has no rate", () => {
    expect(
      reinstatedStatus({
        payType: "HOURLY",
        payScheduleId: "sched-1",
        hourlyRateCents: null,
      }),
    ).toBe("INACTIVE");
  });

  it("returns INACTIVE when an hourly employee has no pay schedule", () => {
    expect(
      reinstatedStatus({
        payType: "HOURLY",
        payScheduleId: null,
        hourlyRateCents: 1300,
      }),
    ).toBe("INACTIVE");
  });

  it("returns ACTIVE for salaried staff without a rate or schedule", () => {
    expect(
      reinstatedStatus({
        payType: "SALARIED",
        payScheduleId: null,
        hourlyRateCents: null,
      }),
    ).toBe("ACTIVE");
  });
});

describe("reinstateEmployee", () => {
  beforeEach(() => {
    selectResults.length = 0;
    updateSets.length = 0;
    updateReturns.length = 0;
    writeAuditMock.mockReset();
  });

  it("flips a terminated employee back to ACTIVE and keeps the notes history", async () => {
    const before = terminated();
    selectResults.push([before], []);
    updateReturns.push([{ ...before, status: "ACTIVE" }]);

    const row = await reinstateEmployee("emp-1", ACTOR);

    expect(row.status).toBe("ACTIVE");
    expect(updateSets[0]?.status).toBe("ACTIVE");
    const notes = String(updateSets[0]?.notes);
    expect(notes.startsWith(`${before.notes}\n[`)).toBe(true);
    expect(notes.endsWith("] reinstated")).toBe(true);
  });

  it("writes the first note when the employee had none", async () => {
    const before = terminated({ notes: null });
    selectResults.push([before], []);
    updateReturns.push([{ ...before, status: "ACTIVE" }]);

    await reinstateEmployee("emp-1", ACTOR);

    expect(String(updateSets[0]?.notes)).toMatch(/^\[.+\] reinstated$/);
  });

  it("lands on INACTIVE when the employee cannot be paid yet", async () => {
    const before = terminated({ hourlyRateCents: null });
    selectResults.push([before], []);
    updateReturns.push([{ ...before, status: "INACTIVE" }]);

    await reinstateEmployee("emp-1", ACTOR);

    expect(updateSets[0]?.status).toBe("INACTIVE");
  });

  it("re-enables the linked login that termination disabled", async () => {
    const before = terminated();
    selectResults.push(
      [before],
      [{ id: "user-1", disabledAt: new Date("2026-09-09T15:36:36Z") }],
    );
    updateReturns.push([{ ...before, status: "ACTIVE" }]);

    await reinstateEmployee("emp-1", ACTOR);

    expect(updateSets).toHaveLength(2);
    expect(updateSets[1]?.disabledAt).toBeNull();
    expect(writeAuditMock.mock.calls[0]?.[0]).toMatchObject({
      action: "employee.reinstate",
      targetType: "Employee",
      targetId: "emp-1",
      actorId: "admin-1",
      after: { status: "ACTIVE", linkedUserEnabled: true },
    });
  });

  it("does not touch the login table when there is no linked login", async () => {
    const before = terminated();
    selectResults.push([before], []);
    updateReturns.push([{ ...before, status: "ACTIVE" }]);

    await reinstateEmployee("emp-1", ACTOR);

    expect(updateSets).toHaveLength(1);
    expect(writeAuditMock.mock.calls[0]?.[0]).toMatchObject({
      after: { linkedUserEnabled: false },
    });
  });

  it("leaves an already-enabled login alone", async () => {
    const before = terminated();
    selectResults.push([before], [{ id: "user-1", disabledAt: null }]);
    updateReturns.push([{ ...before, status: "ACTIVE" }]);

    await reinstateEmployee("emp-1", ACTOR);

    expect(updateSets).toHaveLength(1);
    expect(writeAuditMock.mock.calls[0]?.[0]).toMatchObject({
      before: { status: "TERMINATED" },
      after: { linkedUserEnabled: false },
    });
  });

  it("stops without an audit row when the row changed under it", async () => {
    // Another admin reinstated between the read and the write: the guarded
    // update matches no row.
    selectResults.push([terminated()]);
    updateReturns.push([]);

    await expect(reinstateEmployee("emp-1", ACTOR)).rejects.toThrow(
      /not terminated/,
    );
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("refuses an employee who is not terminated and writes nothing", async () => {
    selectResults.push([terminated({ status: "ACTIVE" })]);

    await expect(reinstateEmployee("emp-1", ACTOR)).rejects.toThrow(
      /not terminated/,
    );
    expect(updateSets).toHaveLength(0);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("throws when the employee does not exist", async () => {
    selectResults.push([]);

    await expect(reinstateEmployee("missing", ACTOR)).rejects.toThrow(
      /not found/,
    );
  });
});
