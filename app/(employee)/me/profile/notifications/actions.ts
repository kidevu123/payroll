"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export async function dismissNotificationAction(
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  await db
    .update(notifications)
    .set({ dismissedAt: new Date(), readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id.data),
        eq(notifications.recipientId, session.user.id),
        isNull(notifications.dismissedAt),
      ),
    );

  revalidatePath("/me/profile/notifications");
}

export async function dismissAllNotificationsAction(): Promise<void> {
  const session = await requireSession();

  await db
    .update(notifications)
    .set({ dismissedAt: new Date(), readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, session.user.id),
        isNull(notifications.dismissedAt),
      ),
    );

  revalidatePath("/me/profile/notifications");
}
