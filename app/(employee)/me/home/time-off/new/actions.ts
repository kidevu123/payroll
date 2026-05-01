"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import { createTimeOffRequest } from "@/lib/db/queries/requests";
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
