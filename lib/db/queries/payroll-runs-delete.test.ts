import { beforeEach, describe, expect, it, vi } from "vitest";

// tx.select() results in call order: the run, then (for a published run) its
// payslips, then its Zoho pushes. tx.delete() calls are counted.
const selectResults: unknown[][] = [];
let deletes = 0;
const writeAuditMock = vi.fn();

const tx = {
  select: () => ({
    from: () => ({ where: () => Promise.resolve(selectResults.shift() ?? []) }),
  }),
  delete: () => ({
    where: () => {
      deletes += 1;
      return Promise.resolve();
    },
  }),
};

vi.mock("@/lib/db", () => ({
  db: { transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) },
}));
vi.mock("@/lib/db/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAuditMock(...args),
}));

import { deleteRun } from "./payroll-runs";
import { RunDeleteRefusedError } from "@/lib/payroll-runs/delete-guard";

const ACTOR = { id: "owner-1", role: "OWNER" as const };
const paidSlip = {
  hoursWorked: "37.6200",
  roundedPayCents: 48900,
  voidedAt: null,
  acknowledgedAt: null,
  signedAt: null,
};

describe("deleteRun", () => {
  beforeEach(() => {
    selectResults.length = 0;
    deletes = 0;
    writeAuditMock.mockReset();
  });

  it("deletes an empty PUBLISHED run and audits it", async () => {
    selectResults.push([{ id: "run-1", state: "PUBLISHED" }], [], []);

    await deleteRun("run-1", ACTOR);

    expect(deletes).toBe(2); // its payslips (none), then the run
    expect(writeAuditMock.mock.calls[0]?.[0]).toMatchObject({
      action: "payroll_run.delete",
      targetId: "run-1",
    });
  });

  it("refuses a PUBLISHED run that has a payslip with pay, and deletes nothing", async () => {
    selectResults.push([{ id: "run-1", state: "PUBLISHED" }], [paidSlip], []);

    await expect(deleteRun("run-1", ACTOR)).rejects.toBeInstanceOf(RunDeleteRefusedError);
    expect(deletes).toBe(0);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("refuses a PUBLISHED run that was pushed to Zoho", async () => {
    selectResults.push([{ id: "run-1", state: "PUBLISHED" }], [], [{ id: "push-1" }]);

    await expect(deleteRun("run-1", ACTOR)).rejects.toThrow(/Zoho/);
    expect(deletes).toBe(0);
  });

  it("still deletes an unpublished run without checking its payslips", async () => {
    selectResults.push([{ id: "run-2", state: "INGEST_FAILED" }]);

    await deleteRun("run-2", ACTOR);

    expect(deletes).toBe(2);
    expect(selectResults).toHaveLength(0);
  });

  it("throws when the run does not exist", async () => {
    selectResults.push([]);
    await expect(deleteRun("missing", ACTOR)).rejects.toThrow(/not found/);
  });
});
