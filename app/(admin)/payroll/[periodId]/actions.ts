"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import {
  getPayslip,
  resolvePayslipDispute,
} from "@/lib/db/queries/payslips";

const idSchema = z.string().uuid();

/**
 * Admin clears an employee-raised dispute. Sets disputeResolvedAt on the
 * payslip; the dispute history stays visible via audit_log + the original
 * disputedAt/disputeReason fields are preserved.
 */
export async function resolveDisputeAction(
  payslipId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(payslipId).success) return { error: "Invalid id." };
  const payslip = await getPayslip(payslipId);
  if (!payslip) return { error: "Not found." };
  await resolvePayslipDispute(payslipId, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath(`/payroll/${payslip.periodId}`);
  revalidatePath("/payroll");
}
