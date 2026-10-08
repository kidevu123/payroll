"use client";

import * as React from "react";
import { AlertTriangle, Bell, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { urlBase64ToBuffer } from "@/lib/notifications/url-base64";
import { isIOSSafari, isStandalonePWA } from "@/lib/pwa/platform";

export function PushToggle({ alreadySubscribed }: { alreadySubscribed: boolean }) {
  const t = useTranslations("employee.notifications");
  const [subscribed, setSubscribed] = React.useState(alreadySubscribed);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [needsHomeScreen, setNeedsHomeScreen] = React.useState(false);

  React.useEffect(() => {
    if (isIOSSafari() && !isStandalonePWA()) {
      setNeedsHomeScreen(true);
    }
  }, []);

  async function enable() {
    setPending(true);
    setError(null);
    try {
      if (isIOSSafari() && !isStandalonePWA()) {
        throw new Error(t("errorIosNeedsHomeScreen"));
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error(t("errorNotSupported"));
      }
      const reg = await navigator.serviceWorker.ready;
      const r = await fetch("/api/push/vapid-public");
      if (!r.ok) throw new Error(t("errorVapidNotConfigured"));
      const { publicKey } = (await r.json()) as { publicKey: string };
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(t("errorPermissionDenied"));
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(publicKey),
      });
      const json = sub.toJSON() as {
        endpoint: string;
        keys?: { p256dh: string; auth: string };
      };
      const save = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!save.ok) throw new Error(t("errorSaveFailed"));
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    setPending(true);
    setError(null);
    try {
      if (!("serviceWorker" in navigator)) throw new Error(t("errorNotSupportedShort"));
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      {needsHomeScreen && !subscribed && (
        <div className="flex items-start gap-2 rounded-input border border-warning-200 bg-warning-50 p-3 text-xs text-warning-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning-700" />
          <div className="space-y-1">
            <p className="font-medium">{t("addToHomeScreen")}</p>
            <p>
              {t.rich("addToHomeScreenBody", {
                share: (chunks) => <strong>{chunks}</strong>,
                add: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>
        </div>
      )}
      {subscribed ? (
        <Button onClick={disable} disabled={pending} variant="secondary" className="w-full">
          <BellOff className="h-4 w-4" />{" "}
          {pending ? t("disabling") : t("disablePush")}
        </Button>
      ) : (
        <Button
          onClick={enable}
          disabled={pending || needsHomeScreen}
          className="w-full"
        >
          <Bell className="h-4 w-4" />{" "}
          {pending ? t("enabling") : t("enablePush")}
        </Button>
      )}
      {error && <p className="text-sm text-danger-700">{error}</p>}
    </div>
  );
}
