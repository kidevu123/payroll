// Punch queries. Edit preserves originalClockIn/Out and demands a reason.
// voidPunch is the soft-delete (sets voidedAt; never DELETEs).

import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods, punches, type Punch, type NewPunch } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "./employees";

/**
 * Refuse any punch mutation on a PAID period. Admins must "Unmark paid"
 * first if they really need to edit paid history — that route writes its
 * own audit row so the reversal is traceable. Throws PERIOD_PAID; the
 * server action layer converts it into a friendly `{error}` response.
 */
async function assertPeriodMutable(
  tx: typeof db,
  periodId: string,
): Promise<void> {
  const [row] = await tx
    .select({ state: payPeriods.state })
    .from(payPeriods)
    .where(eq(payPeriods.id, periodId));
  if (row?.state === "PAID") throw new Error("PERIOD_PAID");
}

/**
 * Refuse a punch whose clock_in OR clock_out falls outside the
 * period's [start, end] range. Owner directive: "this shouldnt even
 * carry over especially if we have weekly gates". Without this guard,
 * a Sun May 3 punch could be attached to the May 4-10 period (because
 * the form's hidden `periodId` is whatever week the admin was looking
 * at), and the misassigned punch then bled into the May 4-10 totals.
 *
 * Comparison is wall-clock-in-tz so an 11pm-ET punch doesn't get
 * pushed to "next day" by UTC bias.
 */
async function assertPunchWithinPeriod(
  tx: typeof db,
  periodId: string,
  clockIn: Date,
  clockOut: Date | null,
  tz: string,
): Promise<void> {
  const [period] = await tx
    .select({ startDate: payPeriods.startDate, endDate: payPeriods.endDate })
    .from(payPeriods)
    .where(eq(payPeriods.id, periodId));
  if (!period) throw new Error("PERIOD_NOT_FOUND");
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const inDay = fmt.format(clockIn);
  const outDay = clockOut ? fmt.format(clockOut) : inDay;
  if (inDay < period.startDate || inDay > period.endDate) {
    throw new Error("PUNCH_OUT_OF_PERIOD");
  }
  if (outDay < period.startDate || outDay > period.endDate) {
    throw new Error("PUNCH_OUT_OF_PERIOD");
  }
}

export type ListPunchesFilters = {
  periodId?: string;
  employeeId?: string;
  includeVoided?: boolean;
  /** Inclusive lower bound on clockIn (UTC). Used by the "All" tab to
   *  collect punches across all periods in a date range. */
  clockAfter?: Date;
  /** Inclusive upper bound on clockIn (UTC). */
  clockBefore?: Date;
};

export async function listPunches(
  filters: ListPunchesFilters,
): Promise<Punch[]> {
  const conds = [];
  if (filters.periodId) conds.push(eq(punches.periodId, filters.periodId));
  if (filters.employeeId)
    conds.push(eq(punches.employeeId, filters.employeeId));
  if (!filters.includeVoided) conds.push(isNull(punches.voidedAt));
  if (filters.clockAfter) conds.push(gte(punches.clockIn, filters.clockAfter));
  if (filters.clockBefore) conds.push(lte(punches.clockIn, filters.clockBefore));
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
    await assertPeriodMutable(tx as unknown as typeof db, input.periodId);
    // Strict period gate: refuse a punch whose times fall outside the
    // chosen period's date range. The company tz is fetched once at
    // call time. (Inline import avoids a circular dep with settings.)
    {
      const { getSetting } = await import("@/lib/settings/runtime");
      const company = await getSetting("company");
      await assertPunchWithinPeriod(
        tx as unknown as typeof db,
        input.periodId,
        input.clockIn,
        input.clockOut ?? null,
        company.timezone,
      );
    }
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
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(punches).where(eq(punches.id, id));
    if (!before) throw new Error(`editPunch: ${id} not found`);
    await assertPeriodMutable(tx as unknown as typeof db, before.periodId);
    {
      const { getSetting } = await import("@/lib/settings/runtime");
      const company = await getSetting("company");
      const nextIn = patch.clockIn ?? before.clockIn;
      const nextOut =
        patch.clockOut !== undefined ? patch.clockOut : before.clockOut;
      await assertPunchWithinPeriod(
        tx as unknown as typeof db,
        before.periodId,
        nextIn,
        nextOut ?? null,
        company.timezone,
      );
    }
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
  // Recompute the affected payslip after the punch tx commits — keeps a
  // published run's total in sync with the new hours. No-op if no
  // published payslip exists yet (admin is in run-prep). Failure here
  // doesn't roll back the punch edit (intentional — the edit landed).
  await recomputePayslipForPunch(result, actor);
  return result;
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
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(punches).where(eq(punches.id, id));
    if (!before) throw new Error(`voidPunch: ${id} not found`);
    if (before.voidedAt) return before;
    await assertPeriodMutable(tx as unknown as typeof db, before.periodId);
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
  await recomputePayslipForPunch(result, actor);
  return result;
}

/**
 * Trigger a payslip recompute for the (employeeId, periodId) of a punch
 * after edit/void completes. No-op when no payslip exists yet. Failure
 * is non-fatal — the punch change already landed.
 */
async function recomputePayslipForPunch(
  punch: Punch,
  actor: Actor,
): Promise<void> {
  const { recomputePayslipForEmployeePeriod } = await import(
    "./payslip-recompute"
  );
  try {
    await recomputePayslipForEmployeePeriod(
      punch.employeeId,
      punch.periodId,
      actor,
    );
  } catch {
    // Non-fatal: the edit/void itself succeeded.
  }
}
