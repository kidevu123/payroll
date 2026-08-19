"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import {
  getMissedPunchAlertById,
  createMissedPunchRequest,
  DuplicatePendingRequestError,
} from "@/lib/db/queries/requests";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";
import { getSetting } from "@/lib/settings/runtime";
import { parseMissedPunchClaim } from "@/lib/missed-punch/claim";

const schema = z.object({
  claimedClockIn: z.string().optional().nullable(),
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
  const company = await getSetting("company");
  const claim = parseMissedPunchClaim({
    claimedClockIn: parsed.data.claimedClockIn,
    claimedClockOut: parsed.data.claimedClockOut,
    timezone: company.timezone,
    issue: alert.issue,
    date: alert.date,
  });
  if (!claim.ok) return { error: claim.error };
  try {
    await createMissedPunchRequest(
      {
        employeeId: alert.employeeId,
        periodId: alert.periodId,
        alertId,
        date: alert.date,
        claimedClockIn: claim.clockIn,
        claimedClockOut: claim.clockOut,
        reason: parsed.data.reason,
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    if (err instanceof DuplicatePendingRequestError) {
      return { error: err.message };
    }
    throw err;
  }
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
