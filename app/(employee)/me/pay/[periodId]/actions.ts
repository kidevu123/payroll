"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth-guards";
import {
  getPayslip,
  markAcknowledged,
  reportPayslipProblem,
} from "@/lib/db/queries/payslips";
import { getEmployee } from "@/lib/db/queries/employees";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";
import { logger } from "@/lib/telemetry";

const idSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(5).max(1000);

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
  revalidatePath(`/me/pay/${payslip.periodId}`);
  revalidatePath("/me/pay");
}

export async function reportPayslipProblemAction(
  payslipId: string,
  reason: string,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!idSchema.safeParse(payslipId).success) return { error: "Invalid id." };
  const parsed = reasonSchema.safeParse(reason);
  if (!parsed.success) {
    return { error: "Please describe the problem in 5–1000 characters." };
  }
  const payslip = await getPayslip(payslipId);
  if (!payslip) return { error: "Not found." };
  if (session.user.employeeId !== payslip.employeeId) {
    return { error: "Forbidden." };
  }
  await reportPayslipProblem(payslipId, parsed.data, {
    id: session.user.id,
    role: session.user.role,
  });

  // Best-effort notify admins. Failures don't block the dispute itself.
  try {
    const [employee, period, admins] = await Promise.all([
      getEmployee(payslip.employeeId),
      getPeriodById(payslip.periodId),
      adminUserIds(),
    ]);
    const employeeName = employee?.displayName ?? "An employee";
    const periodLabel = period
      ? `${period.startDate} – ${period.endDate}`
      : "a payslip";
    await dispatch(
      admins.map((recipientId) => ({
        recipientId,
        kind: "payslip.disputed" as const,
        payload: {
          payslipId,
          periodId: payslip.periodId,
          employeeId: payslip.employeeId,
          employeeName,
          periodLabel,
          reason: parsed.data,
        },
      })),
    );
  } catch (err) {
    logger.warn(
      { err, payslipId },
      "reportPayslipProblemAction: admin notify failed",
    );
  }

  revalidatePath(`/me/pay/${payslip.periodId}`);
  revalidatePath("/me/pay");
  revalidatePath(`/payroll/${payslip.periodId}`);
}
