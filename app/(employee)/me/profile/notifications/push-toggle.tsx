"use client";

import * as React from "react";
import { Bell, BellOff } from "lucide-react";
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

export function PushToggle({ alreadySubscribed }: { alreadySubscribed: boolean }) {
  const [subscribed, setSubscribed] = React.useState(alreadySubscribed);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function enable() {
    setPending(true);
    setError(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Push not supported in this browser.");
      }
      const reg = await navigator.serviceWorker.ready;
      const r = await fetch("/api/push/vapid-public");
      if (!r.ok) throw new Error("VAPID not configured on server.");
      const { publicKey } = (await r.json()) as { publicKey: string };
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Permission denied.");
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
      if (!save.ok) throw new Error("Failed to save subscription.");
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
      if (!("serviceWorker" in navigator)) throw new Error("Not supported.");
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
      {subscribed ? (
        <Button onClick={disable} disabled={pending} variant="secondary" className="w-full">
          <BellOff className="h-4 w-4" />{" "}
          {pending ? "Disabling…" : "Disable push notifications"}
        </Button>
      ) : (
        <Button onClick={enable} disabled={pending} className="w-full">
          <Bell className="h-4 w-4" />{" "}
          {pending ? "Enabling…" : "Enable push notifications"}
        </Button>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
