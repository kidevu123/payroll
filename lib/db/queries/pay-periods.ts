// Pay-period queries. ensureNextPeriod() is idempotent and is called by
// the period-rollover daily job; it can also be called from any code path
// that needs to confirm an OPEN period exists for "today".

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods, type PayPeriod } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import { getSetting } from "@/lib/settings/runtime";
import {
  getNextPeriodBounds,
  getPeriodBounds,
} from "@/lib/payroll/period-boundaries";
import type { Actor } from "./employees";

export type ListPeriodsOpts = {
  limit?: number;
  /** Include only periods with startDate < this YYYY-MM-DD (paginates older). */
  before?: string;
};

export async function listPeriods(opts: ListPeriodsOpts = {}): Promise<PayPeriod[]> {
  const limit = opts.limit ?? 30;
  const q = db.select().from(payPeriods);
  const where = opts.before ? lte(payPeriods.startDate, opts.before) : undefined;
  const rows = where ? await q.where(where) : await q;
  return rows
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    .slice(0, limit);
}

export async function getPeriodById(id: string): Promise<PayPeriod | null> {
  const [row] = await db.select().from(payPeriods).where(eq(payPeriods.id, id));
  return row ?? null;
}

/** Period whose [startDate,endDate] contains today (in company TZ as a YYYY-MM-DD). */
export async function getCurrentPeriod(today: string): Promise<PayPeriod | null> {
  const [row] = await db
    .select()
    .from(payPeriods)
    .where(
      and(lte(payPeriods.startDate, today), gte(payPeriods.endDate, today)),
    )
    .limit(1);
  return row ?? null;
}

export async function lockPeriod(id: string, actor: Actor): Promise<PayPeriod> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, id));
    if (!before) throw new Error(`lockPeriod: ${id} not found`);
    if (before.state === "LOCKED" || before.state === "PAID") return before;
    const [row] = await tx
      .update(payPeriods)
      .set({ state: "LOCKED", lockedAt: new Date(), lockedById: actor.id })
      .where(eq(payPeriods.id, id))
      .returning();
    if (!row) throw new Error("lockPeriod: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "period.lock",
        targetType: "PayPeriod",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function unlockPeriod(
  id: string,
  reason: string,
  actor: Actor,
): Promise<PayPeriod> {
  if (!reason.trim()) throw new Error("unlockPeriod: reason is required");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, id));
    if (!before) throw new Error(`unlockPeriod: ${id} not found`);
    if (before.state === "PAID") {
      throw new Error("unlockPeriod: cannot unlock a PAID period");
    }
    const [row] = await tx
      .update(payPeriods)
      .set({ state: "OPEN", lockedAt: null, lockedById: null })
      .where(eq(payPeriods.id, id))
      .returning();
    if (!row) throw new Error("unlockPeriod: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "period.unlock",
        targetType: "PayPeriod",
        targetId: id,
        before,
        after: { ...row, reason },
      },
      tx,
    );
    return row;
  });
}

/**
 * Idempotent: ensure an OPEN period exists for `today`. If a row already
 * covers today, returns it. Otherwise computes bounds from `payPeriod`
 * settings and inserts.
 *
 * `today` is a YYYY-MM-DD string in company timezone. The caller is
 * responsible for the conversion.
 */
export async function ensureNextPeriod(
  today: string,
  actor: Actor | null = null,
): Promise<PayPeriod> {
  const settings = await getSetting("payPeriod");
  const bounds = getPeriodBounds(today, settings);

  // First try a startDate match — that's our unique key.
  const [existing] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.startDate, bounds.startDate));
  if (existing) return existing;

  return db.transaction(async (tx) => {
    // Re-check inside the transaction in case another caller raced us.
    const [racingExisting] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.startDate, bounds.startDate));
    if (racingExisting) return racingExisting;
    const [row] = await tx
      .insert(payPeriods)
      .values({
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        state: "OPEN",
      })
      .returning();
    if (!row) throw new Error("ensureNextPeriod: insert returned no row");
    await writeAudit(
      {
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: "period.create",
        targetType: "PayPeriod",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function getMostRecentPeriod(): Promise<PayPeriod | null> {
  const [row] = await db
    .select()
    .from(payPeriods)
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  return row ?? null;
}

export async function countPeriods(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payPeriods);
  return row?.n ?? 0;
}

export { getNextPeriodBounds };
