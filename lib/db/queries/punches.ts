// Punch queries. Edit preserves originalClockIn/Out and demands a reason.
// voidPunch is the soft-delete (sets voidedAt; never DELETEs).

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { punches, type Punch, type NewPunch } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "./employees";

export type ListPunchesFilters = {
  periodId?: string;
  employeeId?: string;
  includeVoided?: boolean;
};

export async function listPunches(
  filters: ListPunchesFilters,
): Promise<Punch[]> {
  const conds = [];
  if (filters.periodId) conds.push(eq(punches.periodId, filters.periodId));
  if (filters.employeeId)
    conds.push(eq(punches.employeeId, filters.employeeId));
  if (!filters.includeVoided) conds.push(isNull(punches.voidedAt));
  const q = db.select().from(punches);
  const rows =
    conds.length > 0 ? await q.where(and(...conds)) : await q;
  return rows.sort((a, b) =>
    a.clockIn.getTime() - b.clockIn.getTime(),
  );
}

export type CreatePunchInput = Omit<
  NewPunch,
  "id" | "createdAt" | "originalClockIn" | "originalClockOut" | "editedAt" | "editedById" | "editReason" | "voidedAt"
>;

export async function createPunch(
  input: CreatePunchInput,
  actor: Actor,
): Promise<Punch> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(punches).values(input).returning();
    if (!row) throw new Error("createPunch: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "punch.create",
        targetType: "Punch",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export type EditPunchPatch = {
  clockIn?: Date;
  clockOut?: Date | null;
  notes?: string | null;
};

export async function editPunch(
  id: string,
  patch: EditPunchPatch,
  reason: string,
  actor: Actor,
): Promise<Punch> {
  if (!reason.trim()) throw new Error("editPunch: reason is required");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(punches).where(eq(punches.id, id));
    if (!before) throw new Error(`editPunch: ${id} not found`);
    const next = {
      ...patch,
      // First edit captures original timestamps; subsequent edits keep them.
      originalClockIn: before.originalClockIn ?? before.clockIn,
      originalClockOut: before.originalClockOut ?? before.clockOut,
      editedAt: new Date(),
      editedById: actor.id,
      editReason: reason,
    };
    const [row] = await tx
      .update(punches)
      .set(next)
      .where(eq(punches.id, id))
      .returning();
    if (!row) throw new Error("editPunch: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "punch.edit",
        targetType: "Punch",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function voidPunch(
  id: string,
  reason: string,
  actor: Actor,
): Promise<Punch> {
  if (!reason.trim()) throw new Error("voidPunch: reason is required");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(punches).where(eq(punches.id, id));
    if (!before) throw new Error(`voidPunch: ${id} not found`);
    if (before.voidedAt) return before;
    const [row] = await tx
      .update(punches)
      .set({
        voidedAt: new Date(),
        editedAt: new Date(),
        editedById: actor.id,
        editReason: reason,
      })
      .where(eq(punches.id, id))
      .returning();
    if (!row) throw new Error("voidPunch: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "punch.void",
        targetType: "Punch",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}
