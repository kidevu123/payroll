"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import {
  lockPeriod,
  markPaid,
  unlockPeriod,
  unmarkPaid,
} from "@/lib/db/queries/pay-periods";
import { getLastPoll } from "@/lib/db/queries/poll-history";
import type { PollSummary } from "@/lib/jobs/handlers/punch-poll";
import {
  recomputePayslip,
  unvoidPayslip,
  voidPayslip,
} from "@/lib/db/queries/payslips";
import {
  findDuplicatePunchClusters,
  mergeDuplicatePunches,
} from "@/lib/db/queries/punches";

const idSchema = z.string().uuid();

export async function lockPeriodAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await lockPeriod(id, { id: session.user.id, role: session.user.role });
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

const unlockSchema = z.object({ reason: z.string().min(1).max(500) });

export async function unlockPeriodAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = unlockSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  await unlockPeriod(id, parsed.data.reason, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

export async function markPaidAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  try {
    await markPaid(id, { id: session.user.id, role: session.user.role });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not mark paid." };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}

const unmarkPaidSchema = z.object({ reason: z.string().min(1).max(500) });

export async function unmarkPaidAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = unmarkPaidSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  try {
    await unmarkPaid(id, parsed.data.reason, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not unmark paid." };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}

export type PollNowResult =
  | { error: string }
  | { ok: true; summary: PollSummary };

/**
 * Manually trigger a punch.poll run. Blocks until the scrape + import
 * completes (typical ~30-60s) and returns a summary the UI can show.
 * Both cron + manual triggers funnel through runPollAndLog so the
 * ngteco_poll_log entry is consistent.
 */
export async function pollNowAction(): Promise<PollNowResult> {
  const session = await requireAdmin();
  // Dynamic import: the runner pulls Playwright + node:fs through the
  // poll handler chain. Top-level import would re-trigger the edge bundle
  // analyzer issue described in punch-poll.ts.
  const { runPollAndLog } = await import(
    "@/lib/jobs/handlers/punch-poll-runner"
  );
  try {
    const summary = await runPollAndLog({
      triggeredBy: "MANUAL",
      triggeredById: session.user.id,
    });
    revalidatePath("/payroll");
    revalidatePath("/time");
    return { ok: true, summary };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Poll failed.",
    };
  }
}

const voidPayslipSchema = z.object({ reason: z.string().min(1).max(500) });

/**
 * Soft-delete one employee's payslip from a run. Works on PUBLISHED runs
 * too — admin override is the bible. The run's total recomputes from the
 * remaining non-voided payslips, so /reports stays consistent without
 * re-publishing.
 */
export async function voidPayslipAction(
  payslipId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(payslipId).success) return { error: "Invalid id." };
  const parsed = voidPayslipSchema.safeParse({
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: "Reason required." };
  try {
    await voidPayslip(payslipId, parsed.data.reason, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not void payslip.",
    };
  }
  // Path is unknown at this layer; revalidate the most likely landing pages.
  revalidatePath("/reports");
  revalidatePath("/payroll");
  return;
}

export async function unvoidPayslipAction(
  payslipId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(payslipId).success) return { error: "Invalid id." };
  try {
    await unvoidPayslip(payslipId, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not unvoid.",
    };
  }
  revalidatePath("/reports");
  revalidatePath("/payroll");
  return;
}

/**
 * Re-stamp a single payslip's hours / gross / rounded from the current
 * punches. Use case: legacy-imported payslip whose stored totals
 * disagree with the actual punch sum, or post-edit recompute after
 * voiding/moving punches.
 */
export async function recomputePayslipAction(
  payslipId: string,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(payslipId).success) return { error: "Invalid id." };
  try {
    await recomputePayslip(payslipId, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not recompute.",
    };
  }
  revalidatePath("/payroll");
  revalidatePath("/reports");
  return { ok: true };
}

/**
 * Recompute every active (non-voided) payslip on a period from current
 * punches. Used to fix legacy/import-doubled payslip totals that were
 * baked at publish time and never refreshed. Returns per-payslip
 * before/after for the UI to display.
 */
export async function recomputeAllPayslipsOnPeriodAction(
  periodId: string,
): Promise<
  | { error: string }
  | {
      ok: true;
      results: Array<{
        payslipId: string;
        employeeId: string;
        beforeHours: number;
        afterHours: number;
        beforeRoundedCents: number;
        afterRoundedCents: number;
      }>;
    }
> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(periodId).success) return { error: "Invalid period id." };
  const { db } = await import("@/lib/db");
  const { payslips, payrollRuns } = await import("@/lib/db/schema");
  const { and, eq, isNull, sql } = await import("drizzle-orm");
  // Snapshot every active payslip on this period before recomputing
  // so we can return the delta to the caller.
  const snapshots = await db
    .select()
    .from(payslips)
    .where(
      and(eq(payslips.periodId, periodId), isNull(payslips.voidedAt)),
    );
  const results: Array<{
    payslipId: string;
    employeeId: string;
    beforeHours: number;
    afterHours: number;
    beforeRoundedCents: number;
    afterRoundedCents: number;
  }> = [];
  for (const before of snapshots) {
    try {
      await recomputePayslip(before.id, {
        id: session.user.id,
        role: session.user.role,
      });
    } catch {
      // recompute may throw for salaried/legacy edge cases; skip
      continue;
    }
    const [after] = await db
      .select()
      .from(payslips)
      .where(eq(payslips.id, before.id));
    if (!after) continue;
    results.push({
      payslipId: before.id,
      employeeId: before.employeeId,
      beforeHours: Number(before.hoursWorked ?? 0),
      afterHours: Number(after.hoursWorked ?? 0),
      beforeRoundedCents: before.roundedPayCents,
      afterRoundedCents: after.roundedPayCents,
    });
  }
  // Recompute the run total to match the new payslip sum.
  await db.execute(sql`
    UPDATE payroll_runs pr
    SET total_amount_cents = COALESCE((
      SELECT SUM(rounded_pay_cents) FROM payslips
      WHERE payroll_run_id = pr.id AND voided_at IS NULL
    ), 0)
    WHERE pr.period_id = ${periodId}
  `);
  void payrollRuns;
  revalidatePath(`/payroll/${periodId}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
  return { ok: true, results };
}

/**
 * Run the duplicate-punch merge over a single period (or all-time when
 * periodId is omitted). Picks the longest-duration row in each cluster
 * and voids the rest with a "dedup: <reason>" audit trail.
 */
export async function mergeDuplicatePunchesAction(
  periodId: string | null,
): Promise<{ error?: string } | { ok: true; voided: number; clusters: number }> {
  const session = await requireAdmin();
  if (periodId !== null && !idSchema.safeParse(periodId).success) {
    return { error: "Invalid period." };
  }
  try {
    const filters = periodId ? { periodId } : {};
    const result = await mergeDuplicatePunches(
      filters,
      "admin-triggered merge of same-minute duplicates",
      { id: session.user.id, role: session.user.role },
    );
    revalidatePath("/payroll");
    revalidatePath("/time");
    if (periodId) revalidatePath(`/payroll/${periodId}`);
    return { ok: true, ...result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not merge duplicates.",
    };
  }
}

export async function countDuplicateClustersAction(
  periodId: string | null,
): Promise<number> {
  await requireAdmin();
  if (periodId !== null && !idSchema.safeParse(periodId).success) return 0;
  const filters = periodId ? { periodId } : {};
  const clusters = await findDuplicatePunchClusters(filters);
  return clusters.length;
}

export async function getLastPollAction(): Promise<{
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean;
  triggeredBy: string;
  pairsInserted: number | null;
  pairsUpdated: number | null;
  errorMessage: string | null;
} | null> {
  await requireAdmin();
  const last = await getLastPoll();
  if (!last) return null;
  return {
    startedAt: last.startedAt.toISOString(),
    finishedAt: last.finishedAt?.toISOString() ?? null,
    ok: last.ok,
    triggeredBy: last.triggeredBy,
    pairsInserted: last.pairsInserted,
    pairsUpdated: last.pairsUpdated,
    errorMessage: last.errorMessage,
  };
}
