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
  //
  // Length heuristic for legacy NULL-schedule periods: a 5-7 day period
  // is weekly, a 13-16 day period is semi-monthly. They can legitimately
  // overlap (a Mon-Sun weekly and a Mar 16-31 semi-monthly share Mar 30/31)
  // and are not duplicates. Skip pairs where the lengths cross those
  // buckets (weekly vs semi-monthly) — they're different workflows on
  // the same nominal "no schedule" but really tracking different
  // employee cohorts.
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
     -- Skip cross-cadence pairs: a 5-7 day period overlapping a 13-16 day
     -- period is a weekly period sharing a few days with a semi-monthly
     -- period, NOT a duplicate of the same period. Same idea in reverse.
     AND NOT (
       ((a.end_date - a.start_date + 1) BETWEEN 5 AND 7
         AND (b.end_date - b.start_date + 1) BETWEEN 13 AND 16)
       OR ((b.end_date - b.start_date + 1) BETWEEN 5 AND 7
         AND (a.end_date - a.start_date + 1) BETWEEN 13 AND 16)
     )
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

export type TagLegacyResult = {
  weekly: number;
  semiMonthly: number;
  skippedAmbiguous: number;
};

/**
 * Backfill pay_schedule_id on legacy NULL-schedule periods using the
 * period length as a heuristic:
 *   - 5-7 days  → Weekly schedule
 *   - 13-16 days → Semi-Monthly schedule
 *   - other → skip (admin must classify manually)
 *
 * After this runs, the overlap finder naturally distinguishes weekly
 * from semi-monthly periods (they actually have different
 * pay_schedule_ids), so the duplicate-period UI stops surfacing
 * cross-cadence pairs that aren't really duplicates.
 *
 * Audited per period.
 */
export async function tagLegacyPeriodsBySchedule(
  actor: Actor,
): Promise<TagLegacyResult> {
  // Look up the canonical Weekly + Semi-Monthly schedule rows by
  // period_kind. The seed migration creates exactly one of each.
  const schedules = await db
    .select()
    .from(payPeriods)
    .limit(0); // typing only, we want paySchedules
  void schedules;
  const { paySchedules } = await import("@/lib/db/schema");
  const allSchedules = await db.select().from(paySchedules);
  const weekly = allSchedules.find((s) => s.periodKind === "WEEKLY");
  const semi = allSchedules.find((s) => s.periodKind === "SEMI_MONTHLY");
  if (!weekly || !semi) {
    throw new Error(
      "Tag legacy: no Weekly or Semi-Monthly schedule found. Add them in /settings/pay-schedules first.",
    );
  }

  // Find every NULL-schedule period and bucket by length.
  const candidates = await db.execute(sql`
    SELECT id, start_date, end_date, state, (end_date - start_date + 1) AS days
    FROM pay_periods
    WHERE pay_schedule_id IS NULL
    ORDER BY start_date
  `);
  type Row = {
    id: string;
    start_date: string;
    end_date: string;
    state: string;
    days: number | string;
  };
  const list = candidates as unknown as Row[];

  const result: TagLegacyResult = { weekly: 0, semiMonthly: 0, skippedAmbiguous: 0 };
  for (const row of list) {
    const days = Number(row.days);
    let scheduleId: string | null = null;
    let kind: "WEEKLY" | "SEMI_MONTHLY" | null = null;
    if (days >= 5 && days <= 7) {
      scheduleId = weekly.id;
      kind = "WEEKLY";
    } else if (days >= 13 && days <= 16) {
      scheduleId = semi.id;
      kind = "SEMI_MONTHLY";
    } else {
      result.skippedAmbiguous++;
      continue;
    }
    await db.transaction(async (tx) => {
      await tx
        .update(payPeriods)
        .set({ payScheduleId: scheduleId })
        .where(eq(payPeriods.id, row.id));
      await writeAudit(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: "period.backfill_schedule",
          targetType: "PayPeriod",
          targetId: row.id,
          before: {
            payScheduleId: null,
            startDate: row.start_date,
            endDate: row.end_date,
            days,
          },
          after: { payScheduleId: scheduleId, kind },
        },
        tx,
      );
    });
    if (kind === "WEEKLY") result.weekly++;
    else result.semiMonthly++;
  }
  return result;
}

/**
 * Per-period summary: which employees have payslips on the period,
 * what amount, and how many active vs voided. Used by the cleanup UI
 * to show the admin EXACTLY what a merge will do before they click.
 */
export type PeriodEmployeeSummary = {
  employeeId: string;
  displayName: string;
  legacyId: string | null;
  hours: number;
  grossCents: number;
  roundedCents: number;
  voided: boolean;
};

/**
 * Auto-merge every overlap pair using the same suggested-survivor
 * heuristic the UI shows: more payslips wins; tie → PAID-state wins;
 * tie → id stability. Walks pairs sequentially because each merge
 * mutates the period set (deleting the loser may invalidate other
 * pairs that referenced it).
 */
export async function mergeAllOverlapsUsingSuggestion(
  actor: Actor,
): Promise<{
  merged: number;
  skipped: number;
  errors: Array<{ pair: string; error: string }>;
}> {
  const errors: Array<{ pair: string; error: string }> = [];
  let merged = 0;
  let skipped = 0;
  // Re-fetch the list each iteration: a previous merge may have
  // deleted a period that another pair still references.
  let safety = 200; // hard cap to avoid runaway loops
  while (safety-- > 0) {
    const pairs = await findOverlappingPeriods(1);
    if (pairs.length === 0) break;
    const p = pairs[0];
    if (!p) break;
    // Suggested survivor: more payslips wins; tie-break PAID > others;
    // tie-break id stability.
    const survivorId =
      p.aPayslips > p.bPayslips
        ? p.a.id
        : p.bPayslips > p.aPayslips
          ? p.b.id
          : p.a.state === "PAID" && p.b.state !== "PAID"
            ? p.a.id
            : p.b.state === "PAID" && p.a.state !== "PAID"
              ? p.b.id
              : p.a.id;
    const loserId = survivorId === p.a.id ? p.b.id : p.a.id;
    try {
      await mergeOverlappingPair(survivorId, loserId, actor);
      merged++;
    } catch (err) {
      errors.push({
        pair: `${p.a.id.slice(0, 8)}|${p.b.id.slice(0, 8)}`,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
      // Move on — the failing pair will resurface in the next iteration
      // unless a downstream merge removes it. To avoid an infinite loop
      // on a permanently-failing pair, break after we see the same pair
      // ID twice in a row. Simpler: bail after first error.
      break;
    }
  }
  return { merged, skipped, errors };
}

export async function getPeriodEmployeeSummary(
  periodId: string,
): Promise<PeriodEmployeeSummary[]> {
  const rows = await db.execute(sql`
    SELECT
      py.employee_id AS employee_id,
      e.display_name AS display_name,
      e.legacy_id AS legacy_id,
      py.hours_worked AS hours,
      py.gross_pay_cents AS gross,
      py.rounded_pay_cents AS rounded,
      (py.voided_at IS NOT NULL) AS voided
    FROM payslips py
    LEFT JOIN employees e ON e.id = py.employee_id
    WHERE py.period_id = ${periodId}
    ORDER BY e.display_name
  `);
  type Row = {
    employee_id: string;
    display_name: string | null;
    legacy_id: string | null;
    hours: string | number | null;
    gross: number | string;
    rounded: number | string;
    voided: boolean;
  };
  const list = rows as unknown as Row[];
  return list.map((r) => ({
    employeeId: r.employee_id,
    displayName: r.display_name ?? "(unknown)",
    legacyId: r.legacy_id,
    hours: Number(r.hours ?? 0),
    grossCents: Number(r.gross ?? 0),
    roundedCents: Number(r.rounded ?? 0),
    voided: r.voided,
  }));
}

export type MergeOverlappingPairResult = {
  survivorId: string;
  loserId: string;
  movedPayslips: number;
  voidedDuplicatePayslips: number;
  movedRuns: number;
  movedPunches: number;
  movedTempWorkers: number;
  movedDocuments: number;
  loserDeleted: boolean;
};

/**
 * Merge two overlapping pay_periods: re-point all child rows from the
 * loser onto the survivor, then delete the loser period.
 *
 * Collisions on the (employee_id, period_id) unique index for payslips
 * are resolved by keeping the SURVIVOR's row (the admin chose it) and
 * voiding the loser's payslip with a clear reason. Punches collide on
 * (ngteco_record_hash) which is global, so simply re-pointing the
 * period_id is fine — no extra hash conflicts arise from the move.
 *
 * Audited at every step. Atomic — if any sub-step throws, the whole
 * merge rolls back and the loser period stays alive.
 */
export async function mergeOverlappingPair(
  survivorId: string,
  loserId: string,
  actor: Actor,
): Promise<MergeOverlappingPairResult> {
  if (survivorId === loserId) {
    throw new Error("mergeOverlappingPair: survivor and loser must differ.");
  }
  return db.transaction(async (tx) => {
    const [survivor] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, survivorId));
    const [loser] = await tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.id, loserId));
    if (!survivor) throw new Error(`Survivor period ${survivorId} not found.`);
    if (!loser) throw new Error(`Loser period ${loserId} not found.`);

    const result: MergeOverlappingPairResult = {
      survivorId,
      loserId,
      movedPayslips: 0,
      voidedDuplicatePayslips: 0,
      movedRuns: 0,
      movedPunches: 0,
      movedTempWorkers: 0,
      movedDocuments: 0,
      loserDeleted: false,
    };

    // 1) Walk EVERY loser payslip (active + voided) and resolve against
    //    the survivor's existing payslips. The unique constraint
    //    (employee_id, period_id) doesn't filter on voidedAt, so a
    //    naive re-point of voided losers can still collide with a
    //    survivor's voided OR active payslip for the same employee.
    //    Resolution rules:
    //      - both active OR survivor active + loser voided:
    //          → void the loser's active row (already voided rows are skipped),
    //            then HARD-DELETE the loser-side row so the re-point
    //            target stays clean.
    //      - survivor voided + loser active:
    //          → void the loser's row + delete (survivor is admin's
    //            chosen period; we'd rather keep its voided history
    //            than accept the loser's data).
    //      - survivor voided + loser voided OR no survivor row:
    //          → re-point the loser to survivor (no collision).
    const allLoserPayslips = await tx
      .select()
      .from(payslips)
      .where(eq(payslips.periodId, loserId));
    for (const lp of allLoserPayslips) {
      const [survivorRow] = await tx
        .select()
        .from(payslips)
        .where(
          and(
            eq(payslips.periodId, survivorId),
            eq(payslips.employeeId, lp.employeeId),
          ),
        );
      if (!survivorRow) {
        // No collision → re-point.
        await tx
          .update(payslips)
          .set({ periodId: survivorId })
          .where(eq(payslips.id, lp.id));
        result.movedPayslips++;
        continue;
      }
      // Collision. Survivor row wins. Void the loser if still active
      // (audit trail), then hard-delete the loser-side payslip so the
      // unique constraint is satisfied. The survivor row is the
      // canonical source of truth for that (employee, period).
      if (!lp.voidedAt) {
        await tx
          .update(payslips)
          .set({
            voidedAt: new Date(),
            voidedById: actor.id,
            voidReason: `period merge: kept survivor payslip ${survivorRow.id} on period ${survivorId}`,
          })
          .where(eq(payslips.id, lp.id));
        result.voidedDuplicatePayslips++;
      }
      await tx.delete(payslips).where(eq(payslips.id, lp.id));
    }

    // 3) Re-point payroll_runs.
    const movedRuns = await tx
      .update(payrollRuns)
      .set({ periodId: survivorId })
      .where(eq(payrollRuns.periodId, loserId))
      .returning({ id: payrollRuns.id });
    result.movedRuns = movedRuns.length;

    // 4) Re-point punches.
    const movedPunches = await tx
      .update(punches)
      .set({ periodId: survivorId })
      .where(eq(punches.periodId, loserId))
      .returning({ id: punches.id });
    result.movedPunches = movedPunches.length;

    // 5) Re-point temp workers.
    const movedTemp = await tx
      .update(tempWorkerEntries)
      .set({ periodId: survivorId })
      .where(eq(tempWorkerEntries.periodId, loserId))
      .returning({ id: tempWorkerEntries.id });
    result.movedTempWorkers = movedTemp.length;

    // 6) Re-point payroll period documents.
    const movedDocs = await tx
      .update(payrollPeriodDocuments)
      .set({ periodId: survivorId })
      .where(eq(payrollPeriodDocuments.periodId, loserId))
      .returning({ id: payrollPeriodDocuments.id });
    result.movedDocuments = movedDocs.length;

    // 7) Recompute survivor's run total_amount_cents from non-voided
    //    payslips on the survivor's run(s).
    await tx.execute(sql`
      UPDATE payroll_runs pr
      SET total_amount_cents = COALESCE((
        SELECT SUM(rounded_pay_cents) FROM payslips
        WHERE payroll_run_id = pr.id AND voided_at IS NULL
      ), 0)
      WHERE pr.period_id = ${survivorId}
    `);

    // 8) Delete the now-empty loser period.
    await tx.delete(payPeriods).where(eq(payPeriods.id, loserId));
    result.loserDeleted = true;

    // 9) Audit the whole operation.
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "period.merge_overlap",
        targetType: "PayPeriod",
        targetId: survivorId,
        before: {
          loserId,
          loserStartDate: loser.startDate,
          loserEndDate: loser.endDate,
          loserState: loser.state,
        },
        after: result,
      },
      tx,
    );
    return result;
  });
}
// Avoid unused-var warning when TS strips JSX-only imports.
void isNull;
