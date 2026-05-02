"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";

const schema = z.object({
  calendarId: z.string().max(200).optional(),
});

export async function saveGoogleCalendarAction(
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireAdmin();
  const parsed = schema.safeParse({
    calendarId: formData.get("calendarId") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  // Merge: preserve OAuth-related fields (connectedEmail, lastPushedAt)
  // that weren't part of this form, so saving the calendar id doesn't
  // wipe a previously-connected Google account.
  const current = await getSetting("googleCalendar");
  await setSetting(
    "googleCalendar",
    {
      ...current,
      calendarId: parsed.data.calendarId ?? "",
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/google-calendar");
  return { ok: true };
}
