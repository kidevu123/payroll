"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import { transitionRun } from "@/lib/db/queries/payroll-runs";
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
  // Kick the publish job. The handler generates PDFs + transitions to PUBLISHED.
  const boss = await getBoss();
  await boss.send("payroll.run.publish", { runId });
  revalidatePath(`/payroll/run/${runId}`);
  revalidatePath("/dashboard");
  redirect(`/payroll/run/${runId}`);
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
