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
  const calendarIdRaw = formData.get("calendarId");
  const parsed = schema.safeParse({
    calendarId:
      typeof calendarIdRaw === "string" ? calendarIdRaw.trim() : "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  // Merge: preserve OAuth-related fields (connectedEmail, lastPushedAt)
  // that weren't part of this form, so saving the calendar id doesn't
  // wipe a previously-connected Google account.
  // Skip the calendarId write entirely if blank — submitting a blank
  // input shouldn't wipe a previously-saved id.
  const current = await getSetting("googleCalendar");
  const nextCalendarId =
    parsed.data.calendarId && parsed.data.calendarId.length > 0
      ? parsed.data.calendarId
      : current.calendarId;
  await setSetting(
    "googleCalendar",
    {
      ...current,
      calendarId: nextCalendarId,
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/google-calendar");
  return { ok: true };
}

/**
 * Drop the stored OAuth refresh token + connected email. The token
 * itself is not revoked at Google's end (owner can do that at
 * myaccount.google.com); this just makes our app forget it.
 */
export async function disconnectGoogleCalendarAction(): Promise<
  { error?: string; ok?: true }
> {
  const session = await requireAdmin();
  const current = await getSetting("googleCalendar");
  await setSetting(
    "googleCalendar",
    {
      ...current,
      connectedEmail: null,
      refreshTokenSealed: null,
      connectedAt: null,
    },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/google-calendar");
  return { ok: true };
}
