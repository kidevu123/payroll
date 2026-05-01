"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import {
  deleteRun,
  publishToPortal,
} from "@/lib/db/queries/payroll-runs";
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

export async function publishReportAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await publishToPortal(id, { id: session.user.id, role: session.user.role });
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
