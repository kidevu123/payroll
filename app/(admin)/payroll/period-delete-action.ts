"use server";

import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  payPeriods,
  payrollRuns,
  payslips,
  punches,
  taskPayLineItems,
  tempWorkerEntries,
  payrollPeriodDocuments,
  ingestExceptions,
  missedPunchAlerts,
} from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth-guards";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";

const schema = z.object({
  periodId: z.string().uuid(),
  confirm: z.string(),
});

/**
 * Owner-only nuclear delete for a single pay period. Cascades through
 * every dependent table:
 *   - payslips (hard delete, derivative)
 *   - payrollRuns (hard delete, derivative)
 *   - punches: SOFT delete (voided_at) per spec
 *   - missed_punch_alerts: hard delete (transient)
 *   - task_pay_line_items: hard delete
 *   - temp_worker_entries: hard delete
 *   - payroll_period_documents: hard delete
 *   - ingest_exceptions: hard delete
 *   - pay_periods: hard delete
 *
 * PAID periods are blocked unless `confirm === "delete paid period"` —
 * an extra safety on top of the standard "delete period" confirm.
 */
export async function deletePeriodAction(
  formData: FormData,
): Promise<{ ok?: true; deleted?: { runs: number; payslips: number; punches: number } } | { error: string }> {
  const session = await requireOwner();
  const parsed = schema.safeParse({
    periodId: formData.get("periodId"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "Invalid input." };

  const [period] = await db.select().from(payPeriods).where(eq(payPeriods.id, parsed.data.periodId));
  if (!period) return { error: "Period not found." };

  const expectedConfirm =
    period.state === "PAID" ? "delete paid period" : "delete period";
  if (parsed.data.confirm.trim() !== expectedConfirm) {
    return { error: `Type "${expectedConfirm}" to confirm.` };
  }

  // Counts BEFORE delete for the audit + UI summary.
  const runCountRow = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM payroll_runs WHERE period_id = ${period.id}`,
  );
  const slipCountRow = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM payslips WHERE period_id = ${period.id}`,
  );
  const punchCountRow = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM punches WHERE period_id = ${period.id} AND voided_at IS NULL`,
  );
  const runCount = runCountRow[0]?.n ?? 0;
  const slipCount = slipCountRow[0]?.n ?? 0;
  const punchCount = punchCountRow[0]?.n ?? 0;

  await db.transaction(async (tx) => {
    // Resolve the run ids first so we can clean ingest_exceptions
    // (which FK-reference runs, not periods).
    const runIds = (
      await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(eq(payrollRuns.periodId, period.id))
    ).map((r) => r.id);
    if (runIds.length > 0) {
      await tx
        .delete(ingestExceptions)
        .where(inArray(ingestExceptions.payrollRunId, runIds));
    }
    // payslips reference both periodId and payrollRunId — delete by
    // periodId is sufficient.
    await tx.delete(payslips).where(eq(payslips.periodId, period.id));
    await tx.delete(payrollRuns).where(eq(payrollRuns.periodId, period.id));
    await tx.delete(taskPayLineItems).where(eq(taskPayLineItems.periodId, period.id));
    await tx.delete(tempWorkerEntries).where(eq(tempWorkerEntries.periodId, period.id));
    await tx.delete(payrollPeriodDocuments).where(eq(payrollPeriodDocuments.periodId, period.id));
    await tx.delete(missedPunchAlerts).where(eq(missedPunchAlerts.periodId, period.id));

    // Punches — soft delete per spec (only the still-active ones).
    await tx
      .update(punches)
      .set({ voidedAt: new Date() })
      .where(and(eq(punches.periodId, period.id), isNull(punches.voidedAt)));

    await tx.delete(payPeriods).where(eq(payPeriods.id, period.id));
  });

  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "pay_period.cascade_delete",
    targetType: "PayPeriod",
    targetId: period.id,
    after: {
      startDate: period.startDate,
      endDate: period.endDate,
      state: period.state,
      runsDeleted: runCount,
      payslipsDeleted: slipCount,
      punchesVoided: punchCount,
    },
  });
  logger.warn(
    { actor: session.user.id, periodId: period.id, runCount, slipCount, punchCount },
    "pay_period.cascade_delete: period removed",
  );

  revalidatePath("/payroll");
  revalidatePath("/dashboard");
  revalidatePath("/reports");

  return { ok: true, deleted: { runs: runCount, payslips: slipCount, punches: punchCount } };
}
