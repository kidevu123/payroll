// Notification router. Resolves channels (defaults from settings,
// overridable per user — Phase 5 ships defaults only; per-user overrides
// land alongside the /me/profile/notifications page) and dispatches.
//
// Each event kind can fire across IN_APP and PUSH. Email is wired in the
// schema but the channel is disabled in defaults (per spec §21 #2).

import { logger } from "@/lib/telemetry";
import { dispatchInApp, type DispatchEntry, type NotificationKind } from "./in-app";
import { dispatchPush, type PushPayload } from "./push";
import { getSetting } from "@/lib/settings/runtime";

export type RecipientPayload = {
  recipientId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  push?: PushPayload;
};

async function channelsFor(kind: NotificationKind): Promise<{
  in_app: boolean;
  email: boolean;
  push: boolean;
}> {
  const settings = await getSetting("notifications").catch(() => null);
  const def = settings?.defaults?.[kind];
  return def ?? { in_app: true, email: false, push: true };
}

export async function dispatch(entries: RecipientPayload[]): Promise<void> {
  if (entries.length === 0) return;
  // Group by kind so we resolve channels once.
  const byKind = new Map<NotificationKind, RecipientPayload[]>();
  for (const e of entries) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  for (const [kind, list] of byKind) {
    const channels = await channelsFor(kind);
    if (channels.in_app) {
      const inApp: DispatchEntry[] = list.map((e) => ({
        recipientId: e.recipientId,
        kind: e.kind,
        payload: e.payload,
      }));
      await dispatchInApp(inApp).catch((err) =>
        logger.error({ err, kind }, "dispatch: in-app failed"),
      );
    }
    if (channels.push) {
      await Promise.all(
        list.map(async (e) => {
          const pushPayload = e.push ?? buildPushFallback(e);
          if (!pushPayload) return;
          await dispatchPush(e.recipientId, pushPayload).catch((err) =>
            logger.warn({ err, kind }, "dispatch: push failed"),
          );
        }),
      );
    }
  }
}

function buildPushFallback(e: RecipientPayload): PushPayload | null {
  switch (e.kind) {
    case "missed_punch.detected":
      return {
        title: "Missed punch",
        body: "We couldn't find your punch. Tap to fix it.",
        url: "/me/home",
        tag: "missed_punch",
      };
    case "missed_punch.request_resolved":
      return {
        title: "Missed-punch request",
        body: "Your missed-punch request was resolved.",
        url: "/me/home",
        tag: "missed_punch_resolved",
      };
    case "time_off.request_resolved":
      return {
        title: "Time-off update",
        body: "Your time-off request status changed.",
        url: "/me/home",
        tag: "time_off_resolved",
      };
    case "payroll_run.published":
      return {
        title: "Payslip ready",
        body: "Your latest payslip is published.",
        url: "/me/pay",
        tag: "payroll_published",
      };
    case "payroll_run.awaiting_review":
      return {
        title: "Payroll ready to review",
        body: "Open the dashboard to approve.",
        url: "/dashboard",
        tag: "payroll_review",
      };
    case "payroll_run.ingest_failed":
      return {
        title: "Payroll ingest failed",
        body: "Open the run for the captured screenshot.",
        url: "/ngteco",
        tag: "ingest_failed",
      };
    case "missed_punch.request_submitted":
    case "time_off.request_submitted":
      return {
        title: "New employee request",
        body: "Open Requests to review.",
        url: "/requests",
        tag: "request_submitted",
      };
    case "period.locked":
      return null; // admins-only on in-app, push is overkill
    default:
      return null;
  }
}
