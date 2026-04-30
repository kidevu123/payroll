// Phase 0.5 regression — setSetting must tolerate a missing prior row.
//
// Bug: setSetting used to call getSetting() to capture the audit "before"
// value. getSetting parsed `{}` against the registry schema, which threw on
// missing required-no-default fields (e.g. company.name). The user therefore
// hit a silent failure during /setup: their User row got written, the company
// settings row didn't.
//
// Fix: read the raw row and audit it as-is (or null if missing). Validate the
// NEW value strictly. Tests below pin both behaviors.

import { describe, it, expect, beforeEach, vi } from "vitest";

const auditCalls: unknown[] = [];
const insertedRows: unknown[] = [];
let storedRow: { value: unknown } | null = null;

vi.mock("@/lib/db", () => {
  // Drizzle's query builders are chainable; return self until terminal where().
  const selectBuilder = {
    from() {
      return this;
    },
    where() {
      // Drizzle returns an array-shaped result when awaited.
      return Promise.resolve(storedRow ? [storedRow] : []);
    },
  };
  const insertBuilder = {
    values(v: { value: unknown }) {
      insertedRows.push(v);
      storedRow = { value: v.value };
      return this;
    },
    onConflictDoUpdate() {
      return Promise.resolve();
    },
  };
  return {
    db: {
      select: () => selectBuilder,
      insert: () => insertBuilder,
    },
    schema: {},
  };
});

vi.mock("@/lib/db/audit", () => ({
  writeAudit: async (entry: unknown) => {
    auditCalls.push(entry);
  },
}));

import { setSetting } from "./runtime";

describe("setSetting (Phase 0.5 regression)", () => {
  beforeEach(() => {
    auditCalls.length = 0;
    insertedRows.length = 0;
    storedRow = null;
  });

  it("succeeds when no prior row exists; audit before is null", async () => {
    await setSetting(
      "company",
      {
        name: "Acme Corp",
        address: "",
        logoPath: null,
        brandColorHex: "#0f766e",
        timezone: "America/New_York",
        locale: "en-US",
      },
      { actorId: "00000000-0000-0000-0000-000000000001", actorRole: "OWNER" },
    );

    expect(insertedRows).toHaveLength(1);
    expect(auditCalls).toHaveLength(1);
    const audit = auditCalls[0] as { before: unknown; after: { name: string } };
    expect(audit.before).toBeNull();
    expect(audit.after.name).toBe("Acme Corp");
  });

  it("audits the prior raw value when a row exists", async () => {
    storedRow = { value: { name: "Old Name", address: "", logoPath: null, brandColorHex: "#0f766e", timezone: "America/New_York", locale: "en-US" } };
    await setSetting(
      "company",
      {
        name: "New Name",
        address: "",
        logoPath: null,
        brandColorHex: "#0f766e",
        timezone: "America/New_York",
        locale: "en-US",
      },
      { actorId: "00000000-0000-0000-0000-000000000001", actorRole: "OWNER" },
    );

    expect(auditCalls).toHaveLength(1);
    const audit = auditCalls[0] as { before: { name: string }; after: { name: string } };
    expect(audit.before.name).toBe("Old Name");
    expect(audit.after.name).toBe("New Name");
  });

  it("rejects an invalid new value (empty company.name) before any write", async () => {
    await expect(
      setSetting(
        "company",
        // Deliberately invalid: name fails .min(1) at runtime.
        { name: "", address: "", logoPath: null, brandColorHex: "#0f766e", timezone: "America/New_York", locale: "en-US" },
        { actorId: "00000000-0000-0000-0000-000000000001", actorRole: "OWNER" },
      ),
    ).rejects.toThrow();

    expect(insertedRows).toHaveLength(0);
    expect(auditCalls).toHaveLength(0);
  });

  it("tolerates a stored row whose shape predates the current schema", async () => {
    // Simulate a row with a now-required field missing. The audit "before"
    // should record it raw without throwing.
    storedRow = { value: { legacyShape: true } };

    await setSetting(
      "company",
      {
        name: "Acme Corp",
        address: "",
        logoPath: null,
        brandColorHex: "#0f766e",
        timezone: "America/New_York",
        locale: "en-US",
      },
      { actorId: "00000000-0000-0000-0000-000000000001", actorRole: "OWNER" },
    );

    expect(auditCalls).toHaveLength(1);
    const audit = auditCalls[0] as { before: { legacyShape: boolean } };
    expect(audit.before.legacyShape).toBe(true);
  });
});
