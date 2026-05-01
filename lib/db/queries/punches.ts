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

/**
 * Find clusters of punches that look like the same physical shift but
 * landed as separate DB rows (the realtime poll stores second-precision
 * timestamps, the CSV importer rounds to the minute). Groups by
 * (employeeId, in-minute, out-minute). Returns only clusters with > 1
 * non-voided row, sorted within each cluster by clockIn.
 *
 * The admin UI uses this to surface duplicates and offer a one-click
 * "void all but the longest" action.
 */
export async function findDuplicatePunchClusters(
  filters: { periodId?: string } = {},
): Promise<
  Array<{
    employeeId: string;
    inMinute: number;
    outMinute: number;
    rows: Punch[];
  }>
> {
  const conds = [isNull(punches.voidedAt)];
  if (filters.periodId) conds.push(eq(punches.periodId, filters.periodId));
  const rows = await db
    .select()
    .from(punches)
    .where(and(...conds));
  const groups = new Map<string, Punch[]>();
  for (const r of rows) {
    const inMin = Math.floor(r.clockIn.getTime() / 60_000);
    const outMin = r.clockOut
      ? Math.floor(r.clockOut.getTime() / 60_000)
      : -1;
    const key = `${r.employeeId}|${inMin}|${outMin}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const out: Array<{
    employeeId: string;
    inMinute: number;
    outMinute: number;
    rows: Punch[];
  }> = [];
  for (const [key, list] of groups) {
    if (list.length <= 1) continue;
    const [employeeId, inS, outS] = key.split("|");
    list.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
    out.push({
      employeeId: employeeId!,
      inMinute: parseInt(inS!, 10),
      outMinute: parseInt(outS!, 10),
      rows: list,
    });
  }
  // Sort clusters by employee + in-time so the admin UI groups read top-down.
  return out.sort((a, b) => {
    if (a.employeeId !== b.employeeId)
      return a.employeeId.localeCompare(b.employeeId);
    return a.inMinute - b.inMinute;
  });
}

/**
 * Within each duplicate cluster, void every punch except the one with the
 * longest closed duration (or the lone open one if all are still on the
 * clock). Idempotent — running again voids nothing because clusters of
 * size 1 are filtered out. Returns the count of voided rows.
 */
export async function mergeDuplicatePunches(
  filters: { periodId?: string } = {},
  reason: string,
  actor: Actor,
): Promise<{ voided: number; clusters: number }> {
  if (!reason.trim()) throw new Error("mergeDuplicatePunches: reason required");
  const clusters = await findDuplicatePunchClusters(filters);
  let voided = 0;
  for (const c of clusters) {
    // Pick the survivor: longest closed duration wins; ties broken by id.
    const ranked = [...c.rows].sort((a, b) => {
      const aClosed = a.clockOut ? 1 : 0;
      const bClosed = b.clockOut ? 1 : 0;
      if (aClosed !== bClosed) return bClosed - aClosed;
      const aDur = a.clockOut
        ? a.clockOut.getTime() - a.clockIn.getTime()
        : 0;
      const bDur = b.clockOut
        ? b.clockOut.getTime() - b.clockIn.getTime()
        : 0;
      if (aDur !== bDur) return bDur - aDur;
      return a.id.localeCompare(b.id);
    });
    const survivor = ranked[0]!;
    for (const r of ranked.slice(1)) {
      await voidPunch(r.id, `dedup: ${reason} (kept ${survivor.id})`, actor);
      voided++;
    }
  }
  return { voided, clusters: clusters.length };
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
