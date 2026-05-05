// Cash drawer ledger.
//
// Single drawer per company. Balance is sum(DEPOSIT.amount) -
// sum(WITHDRAWAL.amount). All entries are append-only — corrections
// happen via offsetting entries, never row mutation, so the drawer
// reconciles against the audit log.

import { eq, desc, sql } from "drizzle-orm";
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

export async function getDrawerBalanceCents(): Promise<number> {
  const [row] = await db
    .select({
      deposits: sql<number>`COALESCE(SUM(CASE WHEN ${cashDrawerEntries.kind} = 'DEPOSIT' THEN ${cashDrawerEntries.amountCents} ELSE 0 END), 0)::bigint`,
      withdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${cashDrawerEntries.kind} = 'WITHDRAWAL' THEN ${cashDrawerEntries.amountCents} ELSE 0 END), 0)::bigint`,
    })
    .from(cashDrawerEntries);
  // Postgres returns bigint as string via the driver — cast both.
  const dep = Number(row?.deposits ?? 0);
  const wd = Number(row?.withdrawals ?? 0);
  return dep - wd;
}

export async function listEntries(limit = 200) {
  return db
    .select({
      entry: cashDrawerEntries,
      period: payPeriods,
      createdByEmail: users.email,
    })
    .from(cashDrawerEntries)
    .leftJoin(payPeriods, eq(cashDrawerEntries.periodId, payPeriods.id))
    .leftJoin(users, eq(cashDrawerEntries.createdById, users.id))
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
    const balance = await getDrawerBalanceCents();
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
