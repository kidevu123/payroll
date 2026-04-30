"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth-guards";
import { getPayslip, markAcknowledged } from "@/lib/db/queries/payslips";

const idSchema = z.string().uuid();

export async function acknowledgePayslipAction(
  payslipId: string,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!idSchema.safeParse(payslipId).success) return { error: "Invalid id." };
  const payslip = await getPayslip(payslipId);
  if (!payslip) return { error: "Not found." };
  // Only the employee that owns the payslip may acknowledge.
  if (session.user.employeeId !== payslip.employeeId) {
    return { error: "Forbidden." };
  }
  await markAcknowledged(payslipId, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath(`/pay/${payslip.periodId}`);
  revalidatePath("/pay");
}
