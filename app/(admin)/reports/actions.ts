"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import {
  deleteRun,
  getRun,
  publishToPortal,
  transitionRun,
} from "@/lib/db/queries/payroll-runs";
import { handlePayrollRunPublish } from "@/lib/jobs/handlers/payroll-run-publish";
import { pushReportToZoho } from "@/lib/zoho/push";

const idSchema = z.string().uuid();

export async function deleteReportAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await deleteRun(id, { id: session.user.id, role: session.user.role });
  revalidatePath("/reports");
}

/**
 * State-aware publish. Walks the run from wherever it is up to
 * "PUBLISHED + visible to portal" in one call:
 *
 *   AWAITING_ADMIN_REVIEW → APPROVED → publish handler → PUBLISHED → portal_at
 *   APPROVED              → publish handler → PUBLISHED → portal_at
 *   PUBLISHED             → portal_at (set if missing)
 *
 * Returns a clear error for terminal states (CANCELLED, INGEST_FAILED, etc.)
 * so the UI button doesn't silently no-op.
 */
export async function publishReportAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const actor = { id: session.user.id, role: session.user.role };
  const run = await getRun(id);
  if (!run) return { error: "Run not found." };

  try {
    if (run.state === "AWAITING_ADMIN_REVIEW") {
      await transitionRun(id, "APPROVED", actor, { approvedById: session.user.id });
      await handlePayrollRunPublish({ runId: id });
    } else if (run.state === "APPROVED") {
      await handlePayrollRunPublish({ runId: id });
    } else if (run.state === "PUBLISHED") {
      // Already at PUBLISHED; just make sure portal flag is set.
    } else if (
      run.state === "CANCELLED" ||
      run.state === "INGEST_FAILED" ||
      run.state === "FAILED"
    ) {
      return {
        error: `Run is in terminal state ${run.state}; cannot publish. Re-upload the CSV to retry.`,
      };
    } else {
      return {
        error: `Run is in state ${run.state}; cannot publish from here. Open the run detail and step it forward.`,
      };
    }
    await publishToPortal(id, actor);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Publish failed.",
    };
  }

  revalidatePath("/reports");
  revalidatePath(`/payroll/${id}`);
}

export async function pushReportToZohoAction(
  reportId: string,
  organizationId: string,
): Promise<{ error?: string; expenseId?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(reportId).success) return { error: "Invalid report id." };
  if (!idSchema.safeParse(organizationId).success) return { error: "Invalid org id." };
  try {
    const result = await pushReportToZoho(reportId, organizationId, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/reports");
    return { expenseId: result.expenseId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Push failed." };
  }
}
