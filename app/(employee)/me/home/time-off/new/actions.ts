"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import { createTimeOffRequest } from "@/lib/db/queries/requests";
import {
  cancelTimeOffRequest,
  getTimeOffRequest,
} from "@/lib/db/queries/time-off";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";

const schema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  type: z.enum(["UNPAID", "SICK", "PERSONAL", "OTHER"]),
  reason: z.string().max(500).optional().nullable(),
});

export async function submitTimeOffAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Not linked." };
  const parsed = schema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    type: formData.get("type") || "PERSONAL",
    reason: formData.get("reason") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    return { error: "End date can't be before start date." };
  }
  try {
    await createTimeOffRequest(
      {
        employeeId: session.user.employeeId,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        type: parsed.data.type,
        reason: parsed.data.reason ?? null,
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "TIME_OFF_OVERLAP") {
      return {
        error:
          "You already have a pending or approved time-off request that overlaps these dates.",
      };
    }
    throw err;
  }
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatch(
      admins.map((id) => ({
        recipientId: id,
        kind: "time_off.request_submitted" as const,
        payload: { startDate: parsed.data.startDate, endDate: parsed.data.endDate, type: parsed.data.type },
      })),
    );
  }
  revalidatePath("/me/home");
  redirect("/me/home");
}

const idSchema = z.string().uuid();

/** Self-cancel a time-off request. The employee can only cancel
 *  their own and only while it's still PENDING — once an admin has
 *  approved or rejected, the request is out of their hands. */
export async function cancelMyTimeOffAction(
  requestId: string,
): Promise<{ error?: string; ok?: true } | void> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Not linked." };
  if (!idSchema.safeParse(requestId).success) {
    return { error: "Invalid request id." };
  }
  const before = await getTimeOffRequest(requestId);
  if (!before) return { error: "Request not found." };
  if (before.employeeId !== session.user.employeeId) {
    return { error: "You can only cancel your own requests." };
  }
  if (before.status === "CANCELLED") {
    return { ok: true }; // already done
  }
  if (before.status !== "PENDING") {
    return {
      error:
        "This request has already been " +
        before.status.toLowerCase() +
        " — ask an admin to cancel it.",
    };
  }
  await cancelTimeOffRequest(requestId, session.user.id, "Cancelled by employee");
  // Notify admins so the request drops off their pending list.
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatch(
      admins.map((id) => ({
        recipientId: id,
        kind: "time_off.request_cancelled" as const,
        payload: { requestId },
      })),
    );
  }
  revalidatePath("/me/home");
  revalidatePath("/requests");
  return { ok: true };
}
