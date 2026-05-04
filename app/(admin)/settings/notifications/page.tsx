import { getSetting } from "@/lib/settings/runtime";
import { vapidConfigured, vapidPublicKey } from "@/lib/notifications/push";
import { NotificationsForm } from "./notifications-form";
import { VapidStatus } from "./vapid-status";
import { TestPushButton } from "./test-push-button";

export const dynamic = "force-dynamic";

function fingerprint(pk: string | null): string | null {
  if (!pk || pk.length < 10) return null;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export default async function Page() {
  const notifications = await getSetting("notifications");
  const configured = vapidConfigured();
  return (
    <div className="space-y-4">
      <VapidStatus
        configured={configured}
        publicKeyHint={fingerprint(vapidPublicKey())}
      />
      {configured && (
        <div className="rounded-card border border-border bg-surface-2 p-4">
          <p className="mb-2 text-sm font-medium">Test delivery</p>
          <p className="mb-3 text-xs text-text-muted">
            Fires a push to your own subscribed devices. If it fails, the
            inline result tells you why (VAPID mismatch, no subscription,
            push service rejection) without needing container logs.
          </p>
          <TestPushButton />
        </div>
      )}
      <NotificationsForm notifications={notifications} />
    </div>
  );
}
