// Shift queries. Owner-defined shifts (NOT an enum).
// Reorder via sortOrder. Archive via archivedAt (soft-delete).

import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { shifts, type Shift } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "./employees";

export async function listShifts(
  opts: { includeArchived?: boolean } = {},
): Promise<Shift[]> {
  const where = opts.includeArchived ? undefined : isNull(shifts.archivedAt);
  const q = db.select().from(shifts);
  const rows = where ? await q.where(where) : await q;
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getShift(id: string): Promise<Shift | null> {
  const [row] = await db.select().from(shifts).where(eq(shifts.id, id));
  return row ?? null;
}

export type CreateShiftInput = {
  name: string;
  colorHex?: string;
  defaultStart?: string | null;
  defaultEnd?: string | null;
};

export async function createShift(
  input: CreateShiftInput,
  actor: Actor,
): Promise<Shift> {
  return db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ m: sql<number>`coalesce(max(${shifts.sortOrder}), -1)::int` })
      .from(shifts);
    const nextOrder = (maxRow?.m ?? -1) + 1;
    const [row] = await tx
      .insert(shifts)
      .values({
        name: input.name,
        colorHex: input.colorHex ?? "#0f766e",
        defaultStart: input.defaultStart ?? null,
        defaultEnd: input.defaultEnd ?? null,
        sortOrder: nextOrder,
      })
      .returning();
    if (!row) throw new Error("createShift: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "shift.create",
        targetType: "Shift",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export type UpdateShiftPatch = {
  name?: string;
  colorHex?: string;
  defaultStart?: string | null;
  defaultEnd?: string | null;
};

export async function updateShift(
  id: string,
  patch: UpdateShiftPatch,
  actor: Actor,
): Promise<Shift> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(shifts).where(eq(shifts.id, id));
    if (!before) throw new Error(`updateShift: shift ${id} not found`);
    const [row] = await tx
      .update(shifts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(shifts.id, id))
      .returning();
    if (!row) throw new Error("updateShift: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "shift.update",
        targetType: "Shift",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function reorderShifts(
  orderedIds: string[],
  actor: Actor,
): Promise<void> {
  if (orderedIds.length === 0) return;
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]!;
      await tx
        .update(shifts)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(eq(shifts.id, id));
    }
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "shift.reorder",
        targetType: "Shift",
        targetId: orderedIds.join(","),
        after: { orderedIds },
      },
      tx,
    );
  });
}

export async function archiveShift(id: string, actor: Actor): Promise<Shift> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(shifts).where(eq(shifts.id, id));
    if (!before) throw new Error(`archiveShift: shift ${id} not found`);
    if (before.archivedAt) return before;
    const [row] = await tx
      .update(shifts)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(shifts.id, id))
      .returning();
    if (!row) throw new Error("archiveShift: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "shift.archive",
        targetType: "Shift",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function listActiveShifts(): Promise<Shift[]> {
  return db
    .select()
    .from(shifts)
    .where(isNull(shifts.archivedAt))
    .orderBy(asc(shifts.sortOrder));
}
