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
    <div className="space-y-5">
      <VapidStatus
        configured={configured}
        publicKeyHint={fingerprint(vapidPublicKey())}
      />
      {configured && (
        <div className="rounded-card border border-border bg-surface-2 p-4">
          <p className="mb-2 text-sm font-medium">Test delivery</p>
          <p className="mb-3 text-xs text-text-muted">
            Pick any user with a subscribed device and fire a push. The
            admin portal isn&apos;t mobile-friendly so subscribing as
            yourself from a phone is awkward — point this at an employee
            who has notifications enabled and confirm delivery there.
            Inline result tells you why if it fails.
          </p>
          <TestPushButton />
        </div>
      )}
      <NotificationsForm notifications={notifications} />
    </div>
  );
}
