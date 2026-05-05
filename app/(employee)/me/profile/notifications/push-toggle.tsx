"use client";

import * as React from "react";
import { AlertTriangle, Bell, BellOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(safe);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

/**
 * iOS Web Push only delivers when the page is launched from a Home
 * Screen icon (PWA standalone mode). A subscription made in a regular
 * Safari tab silently never receives anything from APNs. Detect this
 * before subscribing so the user gets actionable guidance instead of
 * a button that quietly does nothing.
 */
function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iOS 13+ reports "MacIntel" platform but has touch events.
  const isIDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" &&
      (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
  return isIDevice;
}

function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  // iOS-specific: window.navigator.standalone. Other browsers: media
  // query display-mode.
  type Nav = Navigator & { standalone?: boolean };
  if ((navigator as Nav).standalone === true) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

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
        <div className="flex items-start gap-2 rounded-input border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
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
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
