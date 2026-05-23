"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import {
  lockPeriod,
  markPaid,
  getPeriodById,
  unlockPeriod,
  unmarkPaid,
} from "@/lib/db/queries/pay-periods";
import {
  createRun,
  getRunForPeriod,
  publishToPortal,
  transitionRun,
} from "@/lib/db/queries/payroll-runs";
import { handlePayrollRunPublish } from "@/lib/jobs/handlers/payroll-run-publish";
import { notifyEmployeesPayslipsPublished } from "@/lib/payroll/published-notifications";
import { getLastPoll } from "@/lib/db/queries/poll-history";
import {
  makeManualPollJobData,
  NGTECO_PUNCH_POLL_QUEUE,
} from "@/lib/jobs/punch-poll-queue";
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

export async function publishLockedPeriodAction(
  periodId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(periodId).success) return { error: "Invalid id." };
  const actor = { id: session.user.id, role: session.user.role };
  const period = await getPeriodById(periodId);
  if (!period) return { error: "Period not found." };
  if (period.state !== "LOCKED") {
    return { error: "Lock the report before publishing." };
  }

  let run = await getRunForPeriod(periodId);
  try {
    if (!run) {
      run = await createRun(periodId, new Date(), actor, {
        payScheduleId: period.payScheduleId,
      });
    }

    if (run.state === "SCHEDULED") {
      run = await transitionRun(run.id, "INGESTING", actor, {
        ingestStartedAt: new Date(),
      });
      run = await transitionRun(run.id, "AWAITING_ADMIN_REVIEW", actor, {
        ingestCompletedAt: new Date(),
        reviewedById: session.user.id,
        reason: "Published directly from locked period",
      });
    }
    if (run.state === "AWAITING_EMPLOYEE_FIXES") {
      run = await transitionRun(run.id, "AWAITING_ADMIN_REVIEW", actor, {
        reviewedById: session.user.id,
        reason: "Published directly from locked period",
      });
    }
    if (run.state === "AWAITING_ADMIN_REVIEW") {
      run = await transitionRun(run.id, "APPROVED", actor, {
        approvedById: session.user.id,
      });
    }
    if (run.state === "APPROVED") {
      await handlePayrollRunPublish({ runId: run.id });
      run = await getRunForPeriod(periodId);
      if (!run)
        return { error: "Publish finished but run could not be reloaded." };
    }
    if (run.state !== "PUBLISHED") {
      return {
        error: `Run is in state ${run.state}; cannot publish from here.`,
      };
    }

    const wasVisible = !!run.publishedToPortalAt;
    await publishToPortal(run.id, actor);
    if (!wasVisible) {
      await notifyEmployeesPayslipsPublished(run.id);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Publish failed." };
  }

  revalidatePath(`/payroll/${periodId}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
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

const markPaidSchema = z.object({
  paymentMethod: z.enum(["BANK", "CASH"]).optional(),
  cashAmountCents: z.coerce.number().int().min(0).optional(),
});

export async function markPaidAction(
  id: string,
  formData?: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  // Form is optional for backwards-compat (existing buttons that
  // don't pass any data still work — they mark paid without a
  // payment-method tag, exactly the prior behavior).
  let parsed: z.infer<typeof markPaidSchema> = {};
  if (formData) {
    const r = markPaidSchema.safeParse({
      paymentMethod: formData.get("paymentMethod") || undefined,
      cashAmountCents: formData.get("cashAmountCents") || undefined,
    });
    if (!r.success) {
      return { error: r.error.issues[0]?.message ?? "Invalid input." };
    }
    parsed = r.data;
  }
  try {
    await markPaid(
      id,
      { id: session.user.id, role: session.user.role },
      {
        ...(parsed.paymentMethod
          ? { paymentMethod: parsed.paymentMethod }
          : {}),
        ...(parsed.cashAmountCents !== undefined
          ? { cashAmountCents: parsed.cashAmountCents }
          : {}),
      },
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not mark paid.",
    };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
  revalidatePath("/cash-drawer");
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
    return {
      error: err instanceof Error ? err.message : "Could not unmark paid.",
    };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}

export type PollNowResult =
  | { error: string }
  | { ok: true; queued: true; jobId: string };

/**
 * Manually trigger a punch.poll run as a background job. The pg-boss
 * worker owns the scrape/import so leaving the page cannot cancel it.
 */
export async function pollNowAction(): Promise<PollNowResult> {
  const session = await requireAdmin();
  try {
    const { getBoss } = await import("@/lib/jobs");
    const boss = await getBoss();
    const jobId = await boss.send(
      NGTECO_PUNCH_POLL_QUEUE,
      makeManualPollJobData(session.user.id),
    );
    if (!jobId) return { error: "Poll could not be queued." };
    return { ok: true, queued: true, jobId };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Poll could not be queued.",
    };
  }
}

const backfillSchema = z.object({
  // 30-day ceiling: matches the auto-recovery cap in punch-poll.ts.
  // NGTeco's "View Attendance Punch" view holds a rolling window
  // (typically 30-90 days) and the scraper's page cap was raised
  // to 200 to actually walk that far back. Operators who need
  // longer should use the legacy "Run NGTeco import now" CSV path
  // which scopes by period dates rather than scrolling the live
  // grid.
  daysBack: z.number().int().min(1).max(30),
});

/**
 * Manually trigger a NGTeco poll that ingests the last `daysBack` days,
 * not just today. Use case: cron didn't run for some reason (login bug,
 * server downtime, NGTeco outage), and now there are punches missing
 * from earlier in the week. Importer dedupes by ngteco_record_hash so
 * re-scraping today's punches in the same window is safe.
 */
export async function backfillPollAction(
  daysBack: number,
): Promise<PollNowResult> {
  const session = await requireAdmin();
  const parsed = backfillSchema.safeParse({ daysBack });
  if (!parsed.success) {
    return { error: "Invalid daysBack — pick a value between 1 and 14." };
  }
  try {
    const { getBoss } = await import("@/lib/jobs");
    const boss = await getBoss();
    const jobId = await boss.send(
      NGTECO_PUNCH_POLL_QUEUE,
      makeManualPollJobData(session.user.id, {
        daysBack: parsed.data.daysBack,
      }),
    );
    if (!jobId) return { error: "Backfill could not be queued." };
    return { ok: true, queued: true, jobId };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Backfill could not be queued.",
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
  // PAID guard: refuse to mutate paid history. Admin must "Unmark paid"
  // first — that step writes its own audit row.
  {
    const { db } = await import("@/lib/db");
    const { payslips, payPeriods } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ state: payPeriods.state })
      .from(payslips)
      .innerJoin(payPeriods, eq(payslips.periodId, payPeriods.id))
      .where(eq(payslips.id, payslipId));
    if (row?.state === "PAID") {
      return { error: "Period is paid. Unmark paid before recomputing." };
    }
  }
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
  if (!idSchema.safeParse(periodId).success)
    return { error: "Invalid period id." };
  const { db } = await import("@/lib/db");
  const { payslips, payrollRuns, payPeriods } = await import("@/lib/db/schema");
  const { and, eq, isNull, sql } = await import("drizzle-orm");
  // PAID guard: refuse to recompute money on a paid period.
  {
    const [pr] = await db
      .select({ state: payPeriods.state })
      .from(payPeriods)
      .where(eq(payPeriods.id, periodId));
    if (pr?.state === "PAID") {
      return { error: "Period is paid. Unmark paid before recomputing." };
    }
  }
  // Snapshot every active payslip on this period before recomputing
  // so we can return the delta to the caller.
  const snapshots = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.periodId, periodId), isNull(payslips.voidedAt)));
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
): Promise<
  { error?: string } | { ok: true; voided: number; clusters: number }
> {
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

// ─────────────────────────────────────────────────────────────────────────────
// Assign / reassign a pay_schedule on an existing pay period. Owner ask:
// "WHY DOES EVERYTHING SAY UNASSIGNED AND IF IT UNASSIGNED HOW THE FUCK
// DO YOU ASSIGN IT" — there was no UI to set the schedule_id on a
// period. This action wires the dropdown on /payroll/[periodId].
// ─────────────────────────────────────────────────────────────────────────────

const assignScheduleSchema = z.object({
  payScheduleId: z
    .union([z.string().uuid(), z.literal("").transform(() => null)])
    .nullable(),
});

export async function assignPeriodScheduleAction(
  periodId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(periodId).success) return { error: "Invalid id." };
  const parsed = assignScheduleSchema.safeParse({
    payScheduleId: formData.get("payScheduleId") || null,
  });
  if (!parsed.success) return { error: "Invalid schedule." };
  const { db } = await import("@/lib/db");
  const { payPeriods } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { writeAudit } = await import("@/lib/db/audit");
  // Surface validation failures as `{error}` so the inline button can
  // show them next to the dropdown. Throwing inside the transaction
  // crashes the server action and leaves the client stuck on "Saving…".
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.id, periodId));
      if (!before) throw new Error("PERIOD_NOT_FOUND");
      if (before.state === "PAID") throw new Error("PERIOD_PAID");
      const [after] = await tx
        .update(payPeriods)
        .set({ payScheduleId: parsed.data.payScheduleId })
        .where(eq(payPeriods.id, periodId))
        .returning();
      await writeAudit(
        {
          actorId: session.user.id,
          actorRole: session.user.role,
          action: "period.assign_schedule",
          targetType: "PayPeriod",
          targetId: periodId,
          before,
          after,
        },
        tx,
      );
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "PERIOD_NOT_FOUND") return { error: "Period not found." };
    if (msg === "PERIOD_PAID")
      return { error: "Can't change the schedule on a PAID period." };
    return { error: "Couldn't save schedule. Try again." };
  }
  revalidatePath(`/payroll/${periodId}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}
