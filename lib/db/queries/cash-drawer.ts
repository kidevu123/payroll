// Cash drawer ledger.
//
// Single drawer per company. Balance is sum(DEPOSIT.amount) -
// sum(WITHDRAWAL.amount). All entries are append-only — corrections
// happen via offsetting entries, never row mutation, so the drawer
// reconciles against the audit log.

import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cashDrawerEntries,
  payPeriods,
  users,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
};

/** Marker on a WITHDRAWAL for an accountant petty-cash purchase. */
export const PETTY_CASH_CATEGORY = "PETTY_CASH";

// Advisory-lock key for the single cash drawer — withdrawals take this so a
// balance-check + insert is atomic against other withdrawals (no overdraft).
const CASH_DRAWER_LOCK_KEY = 48230011;

export async function getDrawerBalanceCents(
  executor: Pick<typeof db, "select"> = db,
): Promise<number> {
  // Voided entries are excluded — a voided deposit/withdrawal no longer
  // affects cash on hand.
  const [row] = await executor
    .select({
      deposits: sql<number>`COALESCE(SUM(CASE WHEN ${cashDrawerEntries.kind} = 'DEPOSIT' THEN ${cashDrawerEntries.amountCents} ELSE 0 END), 0)::bigint`,
      withdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${cashDrawerEntries.kind} = 'WITHDRAWAL' THEN ${cashDrawerEntries.amountCents} ELSE 0 END), 0)::bigint`,
    })
    .from(cashDrawerEntries)
    .where(isNull(cashDrawerEntries.voidedAt));
  // Postgres returns bigint as string via the driver — cast both.
  const dep = Number(row?.deposits ?? 0);
  const wd = Number(row?.withdrawals ?? 0);
  return dep - wd;
}

export async function listEntries(limit = 200) {
  // Voided entries are hidden from the ledger (the audit log retains them).
  return db
    .select({
      entry: cashDrawerEntries,
      period: payPeriods,
      createdByEmail: users.email,
    })
    .from(cashDrawerEntries)
    .leftJoin(payPeriods, eq(cashDrawerEntries.periodId, payPeriods.id))
    .leftJoin(users, eq(cashDrawerEntries.createdById, users.id))
    .where(isNull(cashDrawerEntries.voidedAt))
    .orderBy(desc(cashDrawerEntries.createdAt))
    .limit(limit);
}

export type DepositInput = {
  amountCents: number;
  invoiceNumber: string;
  notes?: string | null;
};

export async function recordDeposit(input: DepositInput, actor: Actor) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Deposit amount must be > 0.");
  }
  if (!input.invoiceNumber.trim()) {
    throw new Error("Invoice number is required for deposits.");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(cashDrawerEntries)
      .values({
        kind: "DEPOSIT",
        amountCents: Math.round(input.amountCents),
        invoiceNumber: input.invoiceNumber.trim(),
        notes: input.notes?.trim() || null,
        createdById: actor.id,
      })
      .returning();
    if (!row) throw new Error("recordDeposit: insert empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "cash_drawer.deposit",
        targetType: "CashDrawerEntry",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export type WithdrawInput = {
  amountCents: number;
  periodId?: string | null;
  notes?: string | null;
  category?: string | null;
};

/** Record a withdrawal. Used both by the period mark-paid flow (with
 *  periodId set) and by manual operator corrections. Refuses to drop
 *  balance below zero — overdraft would mask either a missing deposit
 *  or a misapplied payment. */
export async function recordWithdrawal(
  input: WithdrawInput,
  actor: Actor,
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Withdrawal amount must be > 0.");
  }
  const run = async (
    t: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => {
    // Serialize withdrawals on the drawer, then read the balance INSIDE this
    // transaction. Previously the balance was read via the global db outside
    // the tx with no lock, so two concurrent withdrawals could both pass the
    // check and overdraft the drawer.
    await t.execute(sql`SELECT pg_advisory_xact_lock(${CASH_DRAWER_LOCK_KEY})`);
    const balance = await getDrawerBalanceCents(t);
    if (balance - input.amountCents < 0) {
      throw new Error(
        `Insufficient cash on hand. Drawer balance is $${(balance / 100).toFixed(2)}; tried to withdraw $${(input.amountCents / 100).toFixed(2)}.`,
      );
    }
    const [row] = await t
      .insert(cashDrawerEntries)
      .values({
        kind: "WITHDRAWAL",
        amountCents: Math.round(input.amountCents),
        invoiceNumber: null,
        notes: input.notes?.trim() || null,
        category: input.category ?? null,
        periodId: input.periodId ?? null,
        createdById: actor.id,
      })
      .returning();
    if (!row) throw new Error("recordWithdrawal: insert empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "cash_drawer.withdraw",
        targetType: "CashDrawerEntry",
        targetId: row.id,
        after: row,
      },
      t,
    );
    return row;
  };
  return tx ? run(tx) : db.transaction(run);
}

export type PettyCashInput = {
  amountCents: number;
  /** What was purchased — required so the ledger is meaningful. */
  description: string;
  /** Optional receipt / reference number. */
  reference?: string | null;
};

/** Record an accountant petty-cash purchase as a categorized WITHDRAWAL. */
export async function recordPettyCash(input: PettyCashInput, actor: Actor) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Purchase amount must be > 0.");
  }
  if (!input.description.trim()) {
    throw new Error("Describe what the petty cash was spent on.");
  }
  const note = input.reference?.trim()
    ? `${input.description.trim()} (ref ${input.reference.trim()})`
    : input.description.trim();
  return recordWithdrawal(
    { amountCents: input.amountCents, periodId: null, notes: note, category: PETTY_CASH_CATEGORY },
    actor,
  );
}

/**
 * Soft-void a manual ledger entry (the "delete" action). The row is kept for
 * audit; balance + ledger exclude it. Payroll-linked withdrawals (periodId
 * set) are refused — those are settled via the payroll flow, and voiding one
 * here would desync the period's paid state.
 */
export async function voidEntry(id: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(cashDrawerEntries)
      .where(eq(cashDrawerEntries.id, id));
    if (!entry) throw new Error("Ledger entry not found.");
    if (entry.voidedAt) throw new Error("Entry is already voided.");
    if (entry.periodId) {
      throw new Error(
        "This withdrawal was recorded by a payroll run — manage it from the payroll period, not the drawer.",
      );
    }
    const [row] = await tx
      .update(cashDrawerEntries)
      .set({ voidedAt: new Date(), voidedById: actor.id })
      .where(and(eq(cashDrawerEntries.id, id), isNull(cashDrawerEntries.voidedAt)))
      .returning();
    if (!row) throw new Error("voidEntry: update empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "cash_drawer.void",
        targetType: "CashDrawerEntry",
        targetId: id,
        before: entry,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export type EditEntryInput = {
  amountCents: number;
  notes?: string | null;
  invoiceNumber?: string | null;
};

/**
 * Edit a manual ledger entry's amount / notes / invoice. Audited (before +
 * after). Payroll-linked entries are refused (same reason as void). Refuses an
 * edit that would drop the running balance below zero.
 */
export async function updateEntry(
  id: string,
  input: EditEntryInput,
  actor: Actor,
) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Amount must be > 0.");
  }
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(cashDrawerEntries)
      .where(eq(cashDrawerEntries.id, id));
    if (!entry) throw new Error("Ledger entry not found.");
    if (entry.voidedAt) throw new Error("Cannot edit a voided entry.");
    if (entry.periodId) {
      throw new Error(
        "This withdrawal was recorded by a payroll run — manage it from the payroll period, not the drawer.",
      );
    }
    // Guard the running balance: removing the old effect and applying the new
    // must not push cash on hand negative.
    const balance = await getDrawerBalanceCents();
    const sign = entry.kind === "DEPOSIT" ? 1 : -1;
    const oldEffect = sign * Number(entry.amountCents);
    const newEffect = sign * Math.round(input.amountCents);
    if (balance - oldEffect + newEffect < 0) {
      throw new Error("That amount would drop the drawer below zero.");
    }
    const [row] = await tx
      .update(cashDrawerEntries)
      .set({
        amountCents: Math.round(input.amountCents),
        notes: input.notes?.trim() || null,
        invoiceNumber:
          entry.kind === "DEPOSIT" ? input.invoiceNumber?.trim() || null : entry.invoiceNumber,
      })
      .where(eq(cashDrawerEntries.id, id))
      .returning();
    if (!row) throw new Error("updateEntry: update empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "cash_drawer.edit",
        targetType: "CashDrawerEntry",
        targetId: id,
        before: entry,
        after: row,
      },
      tx,
    );
    return row;
  });
}
