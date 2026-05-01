"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import { getMissedPunchAlertById, createMissedPunchRequest } from "@/lib/db/queries/requests";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";

const schema = z.object({
  claimedClockIn: z.string().min(1),
  claimedClockOut: z.string().optional().nullable(),
  reason: z.string().min(1).max(500),
});

export async function submitMissedPunchAction(
  alertId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Not linked." };
  const alert = await getMissedPunchAlertById(alertId);
  if (!alert) return { error: "Alert not found or already resolved." };
  if (alert.employeeId !== session.user.employeeId) return { error: "Forbidden." };
  const parsed = schema.safeParse({
    claimedClockIn: formData.get("claimedClockIn"),
    claimedClockOut: formData.get("claimedClockOut") || null,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const inDate = new Date(parsed.data.claimedClockIn);
  if (Number.isNaN(inDate.getTime())) return { error: "Invalid in time." };
  let outDate: Date | null = null;
  if (parsed.data.claimedClockOut) {
    outDate = new Date(parsed.data.claimedClockOut);
    if (Number.isNaN(outDate.getTime())) return { error: "Invalid out time." };
  }
  await createMissedPunchRequest(
    {
      employeeId: alert.employeeId,
      periodId: alert.periodId,
      alertId,
      date: alert.date,
      claimedClockIn: inDate,
      claimedClockOut: outDate,
      reason: parsed.data.reason,
    },
    { id: session.user.id, role: session.user.role },
  );
  // Notify admins.
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatch(
      admins.map((id) => ({
        recipientId: id,
        kind: "missed_punch.request_submitted" as const,
        payload: { alertId, date: alert.date, employeeId: alert.employeeId },
      })),
    );
  }
  revalidatePath("/me/home");
  redirect("/me/home");
}
