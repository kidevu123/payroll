// Temp / manual-labor entries — people who don't punch in but whose pay
// must roll into a period's total (e.g. a day-labor contractor paid a flat
// fee). Soft-delete only; the row stays for audit history.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tempWorkerEntries,
  type TempWorkerEntry,
  type NewTempWorkerEntry,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "./employees";

export type TempWorkerListFilters = {
  periodId?: string;
  includeDeleted?: boolean;
};

export async function listTempWorkers(
  filters: TempWorkerListFilters = {},
): Promise<TempWorkerEntry[]> {
  const conds = [];
  if (filters.periodId)
    conds.push(eq(tempWorkerEntries.periodId, filters.periodId));
  if (!filters.includeDeleted)
    conds.push(isNull(tempWorkerEntries.deletedAt));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const q = db.select().from(tempWorkerEntries);
  const rows = where ? await q.where(where) : await q;
  return rows.sort((a, b) => a.workerName.localeCompare(b.workerName));
}

/**
 * Sum amount_cents (excluding soft-deleted rows) per period for a list of
 * period IDs. Used by the reports table to roll temp totals into the
 * period subtotal. Returns a Map for O(1) lookup.
 */
export async function sumByPeriod(
  periodIds: string[],
): Promise<Map<string, number>> {
  if (periodIds.length === 0) return new Map();
  const rows = await db
    .select({
      periodId: tempWorkerEntries.periodId,
      total: sql<number>`COALESCE(SUM(${tempWorkerEntries.amountCents}), 0)::int`,
    })
    .from(tempWorkerEntries)
    .where(
      and(
        inArray(tempWorkerEntries.periodId, periodIds),
        isNull(tempWorkerEntries.deletedAt),
      ),
    )
    .groupBy(tempWorkerEntries.periodId);
  return new Map(rows.map((r) => [r.periodId, Number(r.total)]));
}

export type CreateTempWorkerInput = Omit<
  NewTempWorkerEntry,
  "id" | "createdAt" | "deletedAt" | "deletedById"
>;

export async function createTempWorker(
  input: CreateTempWorkerInput,
  actor: Actor,
): Promise<TempWorkerEntry> {
  if (!input.workerName.trim())
    throw new Error("createTempWorker: worker name is required");
  if (input.amountCents <= 0)
    throw new Error("createTempWorker: amount must be > 0");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tempWorkerEntries)
      .values(input)
      .returning();
    if (!row) throw new Error("createTempWorker: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "temp_worker.create",
        targetType: "TempWorkerEntry",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export type UpdateTempWorkerPatch = Partial<
  Pick<
    NewTempWorkerEntry,
    "workerName" | "description" | "hours" | "amountCents" | "notes"
  >
>;

export async function updateTempWorker(
  id: string,
  patch: UpdateTempWorkerPatch,
  actor: Actor,
): Promise<TempWorkerEntry> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(tempWorkerEntries)
      .where(eq(tempWorkerEntries.id, id));
    if (!before)
      throw new Error(`updateTempWorker: ${id} not found`);
    if (before.deletedAt)
      throw new Error("updateTempWorker: cannot edit a deleted entry");
    const [row] = await tx
      .update(tempWorkerEntries)
      .set(patch)
      .where(eq(tempWorkerEntries.id, id))
      .returning();
    if (!row) throw new Error("updateTempWorker: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "temp_worker.update",
        targetType: "TempWorkerEntry",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function deleteTempWorker(
  id: string,
  actor: Actor,
): Promise<TempWorkerEntry> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(tempWorkerEntries)
      .where(eq(tempWorkerEntries.id, id));
    if (!before) throw new Error(`deleteTempWorker: ${id} not found`);
    if (before.deletedAt) return before;
    const [row] = await tx
      .update(tempWorkerEntries)
      .set({ deletedAt: new Date(), deletedById: actor.id })
      .where(eq(tempWorkerEntries.id, id))
      .returning();
    if (!row) throw new Error("deleteTempWorker: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "temp_worker.delete",
        targetType: "TempWorkerEntry",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

