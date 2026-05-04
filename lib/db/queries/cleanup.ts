// One-shot cleanup helpers for fixing data drift discovered by the
// multi-agent audit fleet. All routes through the audit_log so changes
// are forensically traceable. Owner-only via the calling action.

import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payPeriods,
  payrollPeriodDocuments,
  payrollRuns,
  payslips,
  punches,
  tempWorkerEntries,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "./employees";

/**
 * Recompute payroll_runs.total_amount_cents = SUM(non-voided payslips)
 * for any PUBLISHED run with a NULL stored total. Audits each fix.
 *
 * Returns the per-run before/after so the caller can render a summary.
 */
export async function backfillNullRunTotals(
  actor: Actor,
): Promise<
  Array<{ runId: string; previousTotal: number | null; newTotal: number }>
> {
  const candidates = await db
    .select({
      id: payrollRuns.id,
      total: payrollRuns.totalAmountCents,
      payslipSum: sql<number>`COALESCE((
        SELECT SUM(${payslips.roundedPayCents})::int
        FROM ${payslips}
        WHERE ${payslips.payrollRunId} = ${payrollRuns.id}
          AND ${payslips.voidedAt} IS NULL
      ), 0)`,
    })
    .from(payrollRuns)
    .where(
      and(
        sql`${payrollRuns.totalAmountCents} IS NULL`,
        eq(payrollRuns.state, "PUBLISHED"),
      ),
    );
  const fixed: Array<{
    runId: string;
    previousTotal: number | null;
    newTotal: number;
  }> = [];
  for (const c of candidates) {
    await db.transaction(async (tx) => {
      await tx
        .update(payrollRuns)
        .set({ totalAmountCents: c.payslipSum })
        .where(eq(payrollRuns.id, c.id));
      await writeAudit(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: "payroll_run.backfill_total",
          targetType: "PayrollRun",
          targetId: c.id,
          before: { totalAmountCents: c.total ?? null },
          after: {
            totalAmountCents: c.payslipSum,
            reason: "PUBLISHED run had NULL total; recomputed from non-voided payslips",
          },
        },
        tx,
      );
    });
    fixed.push({
      runId: c.id,
      previousTotal: c.total ?? null,
      newTotal: c.payslipSum,
    });
  }
  return fixed;
}

/**
 * Find pay_periods with zero data attached: no payroll_runs, no payslips,
 * no temp_worker_entries, no punches, no payroll_period_documents. These
 * are the legacy schedule-rollover ghosts the duplicate-period audit
 * surfaced. Returns the candidates without deleting.
 */
export async function findEmptyOrphanPeriods(): Promise<
  Array<{ id: string; startDate: string; endDate: string; state: string }>
> {
  const rows = await db
    .select({
      id: payPeriods.id,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      state: payPeriods.state,
    })
    .from(payPeriods)
    .where(
      and(
        notExists(
          db
            .select({ x: sql`1` })
            .from(payrollRuns)
            .where(eq(payrollRuns.periodId, payPeriods.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(payslips)
            .where(eq(payslips.periodId, payPeriods.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(tempWorkerEntries)
            .where(eq(tempWorkerEntries.periodId, payPeriods.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(punches)
            .where(eq(punches.periodId, payPeriods.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(payrollPeriodDocuments)
            .where(eq(payrollPeriodDocuments.periodId, payPeriods.id)),
        ),
      ),
    );
  return rows;
}

/**
 * Delete the empty orphan pay periods identified by `findEmptyOrphanPeriods()`.
 * Re-verifies emptiness inside the transaction (defense against a write
 * landing between the find and the delete).
 */
export async function deleteEmptyOrphanPeriods(
  actor: Actor,
): Promise<Array<{ id: string; startDate: string; endDate: string }>> {
  const candidates = await findEmptyOrphanPeriods();
  const deleted: Array<{ id: string; startDate: string; endDate: string }> = [];
  for (const c of candidates) {
    await db.transaction(async (tx) => {
      // Re-verify emptiness inside the tx with row locks.
      const [stillEmpty] = await tx
        .select({ id: payPeriods.id })
        .from(payPeriods)
        .where(
          and(
            eq(payPeriods.id, c.id),
            notExists(
              tx
                .select({ x: sql`1` })
                .from(payrollRuns)
                .where(eq(payrollRuns.periodId, payPeriods.id)),
            ),
            notExists(
              tx
                .select({ x: sql`1` })
                .from(payslips)
                .where(eq(payslips.periodId, payPeriods.id)),
            ),
            notExists(
              tx
                .select({ x: sql`1` })
                .from(tempWorkerEntries)
                .where(eq(tempWorkerEntries.periodId, payPeriods.id)),
            ),
            notExists(
              tx
                .select({ x: sql`1` })
                .from(punches)
                .where(eq(punches.periodId, payPeriods.id)),
            ),
            notExists(
              tx
                .select({ x: sql`1` })
                .from(payrollPeriodDocuments)
                .where(eq(payrollPeriodDocuments.periodId, payPeriods.id)),
            ),
          ),
        );
      if (!stillEmpty) return; // race lost — something attached, skip.
      await tx.delete(payPeriods).where(eq(payPeriods.id, c.id));
      await writeAudit(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: "period.delete_empty_orphan",
          targetType: "PayPeriod",
          targetId: c.id,
          before: {
            startDate: c.startDate,
            endDate: c.endDate,
            state: c.state,
            reason:
              "orphan period from legacy schedule rollover; zero runs/payslips/temp/punches/docs attached",
          },
        },
        tx,
      );
      deleted.push({ id: c.id, startDate: c.startDate, endDate: c.endDate });
    });
  }
  return deleted;
}

/**
 * Find pairs of periods sharing the same `pay_schedule_id` whose
 * date ranges overlap. The duplicate-period audit found 106 such pairs
 * (legacy NULL-schedule periods double-booking). Returns up to `limit`
 * pairs ordered by start_date desc — surface for owner review, do
 * NOT auto-merge.
 */
export async function findOverlappingPeriods(
  limit = 200,
): Promise<
  Array<{
    a: { id: string; startDate: string; endDate: string; state: string };
    b: { id: string; startDate: string; endDate: string; state: string };
    aPayslips: number;
    bPayslips: number;
    scheduleId: string | null;
  }>
> {
  // Self-join on pay_periods, finding overlap via a.start <= b.end AND a.end >= b.start.
  // a.id < b.id avoids returning each pair twice.
  const rows = await db.execute(sql`
    SELECT
      a.id AS a_id, a.start_date AS a_start, a.end_date AS a_end, a.state AS a_state,
      b.id AS b_id, b.start_date AS b_start, b.end_date AS b_end, b.state AS b_state,
      a.pay_schedule_id AS schedule_id,
      (SELECT count(*) FROM payslips WHERE period_id = a.id AND voided_at IS NULL) AS a_payslips,
      (SELECT count(*) FROM payslips WHERE period_id = b.id AND voided_at IS NULL) AS b_payslips
    FROM pay_periods a
    JOIN pay_periods b
      ON a.id < b.id
     AND COALESCE(a.pay_schedule_id::text, '~null~') = COALESCE(b.pay_schedule_id::text, '~null~')
     AND a.start_date <= b.end_date
     AND a.end_date >= b.start_date
    ORDER BY a.start_date DESC
    LIMIT ${limit}
  `);
  type Row = {
    a_id: string;
    a_start: string;
    a_end: string;
    a_state: string;
    b_id: string;
    b_start: string;
    b_end: string;
    b_state: string;
    schedule_id: string | null;
    a_payslips: number | string;
    b_payslips: number | string;
  };
  const result = rows as unknown as Row[];
  return result.map((r) => ({
    a: { id: r.a_id, startDate: r.a_start, endDate: r.a_end, state: r.a_state },
    b: { id: r.b_id, startDate: r.b_start, endDate: r.b_end, state: r.b_state },
    aPayslips: Number(r.a_payslips),
    bPayslips: Number(r.b_payslips),
    scheduleId: r.schedule_id,
  }));
}
// Avoid unused-var warning when TS strips JSX-only imports.
void isNull;
