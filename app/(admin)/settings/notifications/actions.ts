"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import { notificationKind } from "@/lib/settings/schemas";

const channelSchema = z.object({
  in_app: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});

export async function updateNotificationsAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  // FormData is name="kind|channel" → "on" / null. Reconstruct the matrix.
  const defaults: Record<string, { in_app: boolean; email: boolean; push: boolean }> = {};
  for (const kind of notificationKind.options) {
    defaults[kind] = {
      in_app: formData.get(`${kind}|in_app`) === "on",
      email: formData.get(`${kind}|email`) === "on",
      push: formData.get(`${kind}|push`) === "on",
    };
  }
  // Sanity-check shape.
  for (const v of Object.values(defaults)) {
    if (!channelSchema.safeParse(v).success) return { error: "Bad shape." };
  }
  const current = await getSetting("notifications");
  await setSetting(
    "notifications",
    { ...current, defaults },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/notifications");
}
