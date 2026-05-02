"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import { getRun, transitionRun } from "@/lib/db/queries/payroll-runs";
import { handlePayrollRunPublish } from "@/lib/jobs/handlers/payroll-run-publish";
import { getBoss } from "@/lib/jobs";

const idSchema = z.string().uuid();

export async function approveRunAction(
  runId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(runId).success) return { error: "Invalid id." };
  await transitionRun(
    runId,
    "APPROVED",
    { id: session.user.id, role: session.user.role },
    { approvedById: session.user.id },
  );
  // Run the publish handler synchronously. Originally we queued via
  // pg-boss and let the worker pick it up async, but a swallowed failure
  // there left runs stuck in APPROVED with zero payslips — and the admin
  // could still click "Publish to portal" on top of that. Running it
  // inline surfaces errors to the caller immediately and keeps the run
  // state truthful.
  try {
    await handlePayrollRunPublish({ runId });
  } catch (err) {
    return {
      error: err instanceof Error
        ? `Publish failed: ${err.message}`
        : "Publish failed.",
    };
  }
  revalidatePath(`/payroll/run/${runId}`);
  revalidatePath("/dashboard");
  redirect(`/payroll/run/${runId}`);
}

/**
 * Re-run the publish handler for a run that's stuck in APPROVED (e.g. the
 * original publish failed mid-flight or pg-boss missed it). Idempotent —
 * upsertPayslip/markPublished/transitionRun all guard their own state.
 */
export async function retryPublishAction(
  runId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(runId).success) return { error: "Invalid id." };
  const run = await getRun(runId);
  if (!run) return { error: "Run not found." };
  if (run.state !== "APPROVED") {
    return { error: `Run is in state ${run.state}; retry only works on APPROVED.` };
  }
  void session;
  try {
    await handlePayrollRunPublish({ runId });
  } catch (err) {
    return {
      error: err instanceof Error
        ? `Publish failed: ${err.message}`
        : "Publish failed.",
    };
  }
  revalidatePath(`/payroll/run/${runId}`);
  revalidatePath("/reports");
}

export async function advanceToReviewAction(
  runId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(runId).success) return { error: "Invalid id." };
  await transitionRun(
    runId,
    "AWAITING_ADMIN_REVIEW",
    { id: session.user.id, role: session.user.role },
    { reviewedById: session.user.id, reason: "Admin advanced before window expired" },
  );
  revalidatePath(`/payroll/run/${runId}`);
  revalidatePath("/dashboard");
}

export async function retryIngestAction(
  runId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(runId).success) return { error: "Invalid id." };
  await transitionRun(
    runId,
    "INGESTING",
    { id: session.user.id, role: session.user.role },
    { ingestStartedAt: new Date(), bumpRetry: true },
  );
  const boss = await getBoss();
  await boss.send("ngteco.import", { runId });
  revalidatePath(`/payroll/run/${runId}`);
}

export async function cancelRunAction(
  runId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(runId).success) return { error: "Invalid id." };
  await transitionRun(runId, "CANCELLED", {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath(`/payroll/run/${runId}`);
  redirect("/payroll");
}
