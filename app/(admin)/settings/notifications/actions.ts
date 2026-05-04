"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import { notificationKind } from "@/lib/settings/schemas";
import { dispatchPush, vapidConfigured } from "@/lib/notifications/push";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

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

export type SendTestPushResult = {
  ok: boolean;
  message: string;
  /** Number of subscriptions found for this user (before the send). */
  subscriptionCount?: number;
  /** Pruned dead subscriptions during the send (404/410/403). */
  pruned?: number;
};

/**
 * Fire a test push to the calling admin's own subscriptions. Returns a
 * detailed status the UI surfaces inline so the admin can debug without
 * tailing container logs. Mostly useful right after VAPID config or
 * after a "this isn't working" report — the new push.ts logger captures
 * statusCode + body so even a silent failure surfaces here.
 */
export async function sendTestPushAction(): Promise<SendTestPushResult> {
  const session = await requireAdmin();
  if (!vapidConfigured()) {
    return {
      ok: false,
      message:
        "VAPID is not configured. Set VAPID_PUBLIC_KEY/PRIVATE_KEY/CONTACT_EMAIL in /etc/payroll/.env and restart the app.",
    };
  }
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, session.user.id));
  if (subs.length === 0) {
    return {
      ok: false,
      message:
        "You have no push subscriptions. Open /me/profile/notifications on the device you want notifications on and tap \"Enable notifications\".",
      subscriptionCount: 0,
    };
  }
  const result = await dispatchPush(session.user.id, {
    title: "Payroll test push",
    body: `Sent ${new Date().toLocaleTimeString()} from /settings/notifications.`,
    url: "/settings/notifications",
    tag: "test",
  });
  if (result.sent === 0 && result.pruned > 0) {
    return {
      ok: false,
      message: `All ${result.pruned} subscription(s) were rejected by the push service (likely VAPID key mismatch — keys changed since the browser subscribed). Re-enable notifications in /me/profile/notifications.`,
      subscriptionCount: subs.length,
      pruned: result.pruned,
    };
  }
  if (result.sent === 0) {
    return {
      ok: false,
      message: `Push dispatched but 0/${subs.length} delivered. Check container logs for "push send failed" — statusCode + body are now logged with details.`,
      subscriptionCount: subs.length,
      pruned: result.pruned,
    };
  }
  return {
    ok: true,
    message: `Sent ${result.sent}/${subs.length} push(es). You should see a banner on the subscribed device within a few seconds.`,
    subscriptionCount: subs.length,
    pruned: result.pruned,
  };
}
