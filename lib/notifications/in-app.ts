// Phase 3 in-app notifications — writes a row to the notifications table.
//
// Phase 5 promotes this to the full router with channel preferences,
// per-user overrides, and Web Push dispatch. Today this is just the
// minimum needed for the bell badge in the admin topbar to populate.

import { and, eq, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, type NewNotification } from "@/lib/db/schema";

export type NotificationKind =
  | "missed_punch.detected"
  | "missed_punch.request_submitted"
  | "missed_punch.request_resolved"
  | "time_off.request_submitted"
  | "time_off.request_resolved"
  | "payroll_run.ingest_failed"
  | "payroll_run.awaiting_review"
  | "payroll_run.published"
  | "period.locked";

export type DispatchEntry = {
  recipientId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

export async function dispatchInApp(entries: DispatchEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const rows: NewNotification[] = entries.map((e) => ({
    recipientId: e.recipientId,
    channel: "IN_APP",
    kind: e.kind,
    payload: e.payload,
    sentAt: new Date(),
  }));
  await db.insert(notifications).values(rows);
  return rows.length;
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, userId),
        isNull(notifications.readAt),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function markRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.recipientId, userId));
}
