import { getSetting } from "@/lib/settings/runtime";
import { vapidConfigured, vapidPublicKey } from "@/lib/notifications/push";
import { NotificationsForm } from "./notifications-form";
import { VapidStatus } from "./vapid-status";

export const dynamic = "force-dynamic";

function fingerprint(pk: string | null): string | null {
  if (!pk || pk.length < 10) return null;
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export default async function Page() {
  const notifications = await getSetting("notifications");
  return (
    <div className="space-y-4">
      <VapidStatus
        configured={vapidConfigured()}
        publicKeyHint={fingerprint(vapidPublicKey())}
      />
      <NotificationsForm notifications={notifications} />
    </div>
  );
}
