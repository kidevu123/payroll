"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting, setSetting } from "@/lib/settings/runtime";
import { notificationKind } from "@/lib/settings/schemas";
import { dispatchPush, vapidConfigured } from "@/lib/notifications/push";
import { db } from "@/lib/db";
import { employees, pushSubscriptions, users } from "@/lib/db/schema";

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

export type SubscribedRecipient = {
  userId: string;
  label: string;
  subscriptionCount: number;
};

/**
 * List every user with at least one active push subscription, with a
 * human-readable label (employee displayName when available, else the
 * user email). Drives the recipient picker on the test-push button —
 * the admin's own browser may not be subscribed (admin portal isn't
 * mobile friendly), so they need to be able to fire a test at any
 * subscribed device on the system.
 */
export async function listSubscribedRecipientsAction(): Promise<SubscribedRecipient[]> {
  await requireAdmin();
  const rows = await db
    .select({
      userId: pushSubscriptions.userId,
      email: users.email,
      employeeName: employees.displayName,
      subscriptionCount: sql<number>`count(*)::int`,
    })
    .from(pushSubscriptions)
    .leftJoin(users, eq(pushSubscriptions.userId, users.id))
    .leftJoin(employees, eq(users.employeeId, employees.id))
    .groupBy(pushSubscriptions.userId, users.email, employees.displayName);
  return rows
    .map((r) => ({
      userId: r.userId,
      label: r.employeeName ?? r.email ?? `User ${r.userId.slice(0, 8)}`,
      subscriptionCount: Number(r.subscriptionCount ?? 0),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Fire a test push to the picked recipient (defaults to the calling
 * admin). Returns a detailed status the UI surfaces inline so the admin
 * can debug without tailing container logs. The new push.ts logger
 * captures statusCode + body so even a silent failure surfaces here.
 */
export async function sendTestPushAction(
  recipientUserId?: string,
): Promise<SendTestPushResult> {
  const session = await requireAdmin();
  if (!vapidConfigured()) {
    return {
      ok: false,
      message:
        "VAPID is not configured. Set VAPID_PUBLIC_KEY/PRIVATE_KEY/CONTACT_EMAIL in /etc/payroll/.env and restart the app.",
    };
  }
  const targetId = recipientUserId ?? session.user.id;
  const isSelf = targetId === session.user.id;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, targetId));
  if (subs.length === 0) {
    return {
      ok: false,
      message: isSelf
        ? "You have no push subscriptions on this account. Pick a different recipient (any employee whose phone is subscribed) from the dropdown — the admin portal isn't mobile-friendly, so subscribing as the admin from a phone usually isn't practical."
        : "That recipient has no push subscriptions. Pick someone else from the list.",
      subscriptionCount: 0,
    };
  }
  const result = await dispatchPush(targetId, {
    title: "Payroll test push",
    body: `Sent ${new Date().toLocaleTimeString()} from /settings/notifications.`,
    url: "/me",
    tag: "test",
  });
  if (result.sent === 0 && result.pruned > 0) {
    return {
      ok: false,
      message: `All ${result.pruned} subscription(s) were rejected by the push service (likely VAPID key mismatch — keys changed since the browser subscribed). The recipient should re-enable notifications in /me/profile/notifications.`,
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
    message: `Sent ${result.sent}/${subs.length} push(es). The recipient should see a banner on the subscribed device within a few seconds.`,
    subscriptionCount: subs.length,
    pruned: result.pruned,
  };
}
