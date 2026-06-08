// Pay-period queries. ensureNextPeriod() is idempotent and is called by
// the period-rollover daily job; it can also be called from any code path
// that needs to confirm an OPEN period exists for "today".

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  payPeriods,
  paySchedules,
  type PayPeriod,
  type PaySchedule,
} from "@/lib/db/schema";
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

/**
 * Period covering `today` for the given pay-schedule id. Used by the
 * employee Home tab to pick the WEEKLY period for a weekly employee
 * even when a SEMI-MONTHLY period also overlaps today (and vice versa).
 * Without this filter, getCurrentPeriod returned whichever row sorted
 * first, so a weekly employee saw "10 days left" against the semi-
 * monthly window.
 */
export async function getCurrentPeriodForSchedule(args: {
  today: string;
  payScheduleId: string;
}): Promise<PayPeriod | null> {
  const [row] = await db
    .select()
    .from(payPeriods)
    .where(
      and(
        eq(payPeriods.payScheduleId, args.payScheduleId),
        lte(payPeriods.startDate, args.today),
        gte(payPeriods.endDate, args.today),
      ),
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

export async function markPaid(
  id: string,
  actor: Actor,
  opts: {
    paymentMethod?: "BANK" | "CASH";
    /** Total to deduct from the cash drawer when paymentMethod=CASH.
     *  Caller computes this (typically grossPayCents sum + temp
     *  worker entries). Required when method=CASH; ignored otherwise. */
    cashAmountCents?: number;
    cashNotes?: string;
  } = {},
): Promise<PayPeriod> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, id));
    if (!before) throw new Error(`markPaid: ${id} not found`);
    if (before.state === "PAID") return before;
    if (before.state !== "LOCKED") {
      throw new Error("markPaid: period must be LOCKED first");
    }

    let cashDrawerEntryId: string | null = null;
    if (opts.paymentMethod === "CASH") {
      if (!opts.cashAmountCents || opts.cashAmountCents <= 0) {
        throw new Error(
          "markPaid: cashAmountCents is required when paymentMethod=CASH.",
        );
      }
      // Defer to the cash-drawer module so balance + audit are
      // consistent with manual deposits/withdrawals.
      const { recordWithdrawal } = await import("./cash-drawer");
      const wd = await recordWithdrawal(
        {
          amountCents: opts.cashAmountCents,
          periodId: id,
          notes: opts.cashNotes ?? null,
        },
        actor,
        tx,
      );
      cashDrawerEntryId = wd.id;
    }

    const [row] = await tx
      .update(payPeriods)
      .set({
        state: "PAID",
        paidAt: new Date(),
        paidById: actor.id,
        paymentMethod: opts.paymentMethod ?? null,
        cashDrawerEntryId,
      })
      .where(eq(payPeriods.id, id))
      .returning();
    if (!row) throw new Error("markPaid: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "period.mark_paid",
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

/**
 * Demote PAID → LOCKED. Used when a period was marked paid by mistake (or
 * by a legacy bulk import) and the admin needs to roll it back. Audit row
 * captures the reason for traceability.
 */
export async function unmarkPaid(
  id: string,
  reason: string,
  actor: Actor,
): Promise<PayPeriod> {
  if (!reason.trim()) throw new Error("unmarkPaid: reason is required");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, id));
    if (!before) throw new Error(`unmarkPaid: ${id} not found`);
    if (before.state !== "PAID") return before;

    // If this period was paid from the cash drawer, reverse the
    // withdrawal so the running balance reflects reality. We don't
    // delete the original withdrawal — it stays in the ledger as a
    // historical record — but we add an offsetting DEPOSIT keyed
    // back to the same period so the audit trail tells the full
    // story. The period's cash_drawer_entry_id is cleared so a
    // future re-pay creates a fresh withdrawal.
    if (before.paymentMethod === "CASH" && before.cashDrawerEntryId) {
      const { cashDrawerEntries } = await import("@/lib/db/schema");
      const [origWithdrawal] = await tx
        .select()
        .from(cashDrawerEntries)
        .where(eq(cashDrawerEntries.id, before.cashDrawerEntryId));
      if (origWithdrawal && origWithdrawal.kind === "WITHDRAWAL") {
        const [reversal] = await tx
          .insert(cashDrawerEntries)
          .values({
            kind: "DEPOSIT",
            amountCents: origWithdrawal.amountCents,
            invoiceNumber: `REV-${origWithdrawal.id.slice(0, 8)}`,
            notes: `Reversal — period ${before.startDate} to ${before.endDate} unmarked paid${reason ? ` (${reason})` : ""}`,
            periodId: id,
            createdById: actor.id,
          })
          .returning();
        if (reversal) {
          await writeAudit(
            {
              actorId: actor.id,
              actorRole: actor.role,
              action: "cash_drawer.reversal",
              targetType: "CashDrawerEntry",
              targetId: reversal.id,
              before: origWithdrawal,
              after: reversal,
            },
            tx,
          );
        }
      }
    }

    const [row] = await tx
      .update(payPeriods)
      .set({
        state: "LOCKED",
        paidAt: null,
        paidById: null,
        paymentMethod: null,
        cashDrawerEntryId: null,
      })
      .where(eq(payPeriods.id, id))
      .returning();
    if (!row) throw new Error("unmarkPaid: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "period.unmark_paid",
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
/**
 * Read-only counterpart to `ensureNextPeriod`. Returns the pay period
 * whose date range contains `today` if one exists; otherwise the most
 * recent period overall; otherwise null. NEVER creates a row.
 *
 * Use this from view paths and informational queries. Only the explicit
 * create flows (CSV upload, manual punch entry) should call
 * `ensureNextPeriod` — the owner doesn't want the system silently
 * creating periods for them anymore.
 */
export async function getEffectivePeriod(today: string): Promise<PayPeriod | null> {
  // Period whose [start_date, end_date] covers today.
  const [containing] = await db
    .select()
    .from(payPeriods)
    .where(
      and(
        sql`${payPeriods.startDate} <= ${today}`,
        sql`${payPeriods.endDate} >= ${today}`,
      ),
    )
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  if (containing) return containing;

  // Fallback: most recent period regardless of date.
  const [latest] = await db
    .select()
    .from(payPeriods)
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  return latest ?? null;
}

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

/**
 * Compute the (startDate, endDate) bounds for the period that contains
 * `day` (YYYY-MM-DD) under the given pay schedule's cadence. Pure —
 * no DB touch. Used both by ensurePeriodForSchedule and the salaried
 * paystub-upload auto-pick. Owner directive: "if I'm uploading a
 * paystub I should just give the date and you figure out the period".
 *
 * WEEKLY  → Monday → Sunday containing `day`.
 * BIWEEKLY → Two-week window aligned to scheduleStartDate (or to the
 *             nearest Monday before `day` when the schedule has none).
 * SEMI_MONTHLY → full calendar month (same as MONTHLY for punches/Time).
 * MONTHLY → 1st-EOM of the month containing `day`.
 */
export function periodBoundsForSchedule(
  day: string,
  schedule: { periodKind: PaySchedule["periodKind"]; anchorDate?: string | null },
): { startDate: string; endDate: string } {
  const d = new Date(`${day}T12:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const dom = d.getUTCDate();
  const dow = d.getUTCDay(); // 0=Sun ... 6=Sat
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (yy: number, mm: number, dd: number) =>
    `${yy}-${pad(mm + 1)}-${pad(dd)}`;

  if (schedule.periodKind === "WEEKLY") {
    // Monday-anchored week. (Mon=1, Sun=0 → Sun maps back 6 days.)
    const back = dow === 0 ? 6 : dow - 1;
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - back);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return {
      startDate: iso(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
      endDate: iso(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    };
  }
  if (schedule.periodKind === "BIWEEKLY") {
    // Two-week window. Anchor: schedule.anchorDate if set; otherwise
    // the Monday on or before `day`.
    const anchorIso = schedule.anchorDate ?? null;
    let anchor: Date;
    if (anchorIso) {
      anchor = new Date(`${anchorIso}T12:00:00Z`);
    } else {
      anchor = new Date(d);
      const back = dow === 0 ? 6 : dow - 1;
      anchor.setUTCDate(anchor.getUTCDate() - back);
    }
    const diffDays = Math.floor(
      (d.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000),
    );
    // Negative-safe modulo so dates before the anchor still land on a
    // valid 14-day window.
    const offset = ((diffDays % 14) + 14) % 14;
    const start = new Date(d);
    start.setUTCDate(start.getUTCDate() - offset);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 13);
    return {
      startDate: iso(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
      endDate: iso(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    };
  }
  if (
    schedule.periodKind === "SEMI_MONTHLY" ||
    schedule.periodKind === "MONTHLY"
  ) {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return { startDate: iso(y, m, 1), endDate: iso(y, m, lastDay) };
  }
  throw new Error(
    `periodBoundsForSchedule: unsupported periodKind ${schedule.periodKind}`,
  );
}

/**
 * Find or create the pay period for a (paySchedule, day) pair. The
 * created row is tagged with payScheduleId and uses the schedule's
 * cadence to compute (start, end). Idempotent on the (payScheduleId,
 * startDate) unique index.
 *
 * Owner directive: when an auto-period gets created (from the punch
 * importer's resolvePeriodIdForDay or the Time-tab forward-roll),
 * tag it with the matching schedule so it doesn't read as UNASSIGNED.
 */
/**
 * Period row for an employee's punch on `dayIso`, using their pay schedule.
 * Weekly employees land in the Mon–Sun week; semi-monthly/monthly in the
 * calendar month — never a sibling schedule's overlapping period.
 */
export async function resolvePeriodIdForEmployeeDay(
  employeeId: string,
  dayIso: string,
): Promise<string | null> {
  const [emp] = await db
    .select({ payScheduleId: employees.payScheduleId })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (emp?.payScheduleId) {
    const period = await ensurePeriodForSchedule(
      emp.payScheduleId,
      dayIso,
      null,
    );
    return period.id;
  }
  const [existing] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(
      and(
        lte(payPeriods.startDate, dayIso),
        gte(payPeriods.endDate, dayIso),
      ),
    )
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  return existing?.id ?? null;
}

export async function ensurePeriodForSchedule(
  scheduleId: string,
  day: string,
  actor: Actor | null = null,
): Promise<PayPeriod> {
  const [schedule] = await db
    .select()
    .from(paySchedules)
    .where(eq(paySchedules.id, scheduleId));
  if (!schedule) {
    throw new Error(`ensurePeriodForSchedule: schedule ${scheduleId} not found`);
  }
  const bounds = periodBoundsForSchedule(day, {
    periodKind: schedule.periodKind,
    anchorDate: schedule.anchorDate,
  });
  const [existing] = await db
    .select()
    .from(payPeriods)
    .where(
      and(
        eq(payPeriods.startDate, bounds.startDate),
        eq(payPeriods.payScheduleId, scheduleId),
      ),
    );
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const [racing] = await tx
      .select()
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.startDate, bounds.startDate),
          eq(payPeriods.payScheduleId, scheduleId),
        ),
      );
    if (racing) return racing;
    const [row] = await tx
      .insert(payPeriods)
      .values({
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        state: "OPEN",
        payScheduleId: scheduleId,
      })
      .returning();
    if (!row) {
      throw new Error("ensurePeriodForSchedule: insert returned no row");
    }
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
