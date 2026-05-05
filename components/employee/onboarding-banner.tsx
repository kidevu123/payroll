"use client";

import * as React from "react";
import { Bell, BookmarkPlus, Check, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "milo.onboarding.dismissed.v1";

type Step =
  | "install" // not yet installed to home screen
  | "notify" // installed, but no notifications yet
  | "done"; // both done — hide

function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" &&
      (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
  return isIDevice;
}

function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  type Nav = Navigator & { standalone?: boolean };
  if ((navigator as Nav).standalone === true) return true;
  return window.matchMedia("(display-mode: standalone)").matches;
}

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
 * Top-of-employee-portal onboarding nudge.
 * - First-time visitors see "Save Milo to your Home Screen" + (when
 *   already standalone) "Turn on notifications".
 * - Dismissable per-device via localStorage; respects the existing
 *   notification subscription (passed in from server).
 * - Hides itself entirely once the user is installed AND subscribed.
 */
export function OnboardingBanner({
  alreadySubscribed,
}: {
  alreadySubscribed: boolean;
}) {
  const [step, setStep] = React.useState<Step | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [showInstallSheet, setShowInstallSheet] = React.useState(false);
  const [installPromptEvent, setInstallPromptEvent] =
    React.useState<BeforeInstallPromptEvent | null>(null);
  const [pending, setPending] = React.useState(false);
  const [subscribed, setSubscribed] = React.useState(alreadySubscribed);
  const [error, setError] = React.useState<string | null>(null);

  // Compute the current step + whether the user has dismissed.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DISMISS_KEY) === "1") {
      setDismissed(true);
      return;
    }
    const standalone = isStandalonePWA();
    if (!standalone) {
      setStep("install");
    } else if (!subscribed) {
      setStep("notify");
    } else {
      setStep("done");
    }
  }, [subscribed]);

  // Capture Android/Chrome's beforeinstallprompt so we can offer a
  // 1-tap install. iOS doesn't fire this — we fall back to instructions.
  React.useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setInstallPromptEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (dismissed || !step || step === "done") return null;

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
    setDismissed(true);
  }

  async function onInstallClick() {
    if (installPromptEvent) {
      // Chrome/Android: native install dialog.
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice.outcome === "accepted") {
        setInstallPromptEvent(null);
      }
      return;
    }
    // iOS Safari + desktop Safari: show share-menu instructions.
    setShowInstallSheet(true);
  }

  async function onEnableNotifications() {
    setPending(true);
    setError(null);
    try {
      if (isIOSSafari() && !isStandalonePWA()) {
        throw new Error(
          "On iPhone/iPad, save Milo to your Home Screen first, then open it from there.",
        );
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Push not supported in this browser.");
      }
      const reg = await navigator.serviceWorker.ready;
      const r = await fetch("/api/push/vapid-public");
      if (!r.ok) throw new Error("Notifications not configured by admin.");
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
      if (!save.ok) throw new Error("Couldn't save subscription.");
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section
        aria-label="Get the most out of Milo"
        className="mx-4 mt-3 mb-1 rounded-card border border-brand-200/60 bg-gradient-to-br from-brand-50/80 via-surface to-surface shadow-card overflow-hidden"
      >
        <div className="flex items-start gap-3 p-4">
          <div className="shrink-0 rounded-full bg-brand-100 p-2 ring-1 ring-inset ring-brand-200/80">
            {step === "install" ? (
              <BookmarkPlus className="h-5 w-5 text-brand-700" />
            ) : (
              <Bell className="h-5 w-5 text-brand-700" />
            )}
          </div>
          <div className="flex-1 space-y-1">
            <h3 className="text-sm font-semibold tracking-tight antialiased">
              {step === "install"
                ? "Save Milo to your Home Screen"
                : "Turn on notifications"}
            </h3>
            <p className="text-xs text-text-muted leading-relaxed">
              {step === "install"
                ? "One tap from your home screen, no Safari, no typing. Get instant updates when your payslip is ready."
                : "We'll ping you the second a new payslip publishes or you have a missed punch. No spam — just the stuff that matters."}
            </p>
            <div className="flex items-center gap-2 pt-1.5">
              {step === "install" ? (
                <Button size="sm" type="button" onClick={onInstallClick}>
                  <BookmarkPlus className="h-4 w-4" /> Add to Home Screen
                </Button>
              ) : (
                <Button
                  size="sm"
                  type="button"
                  disabled={pending}
                  onClick={onEnableNotifications}
                >
                  <Bell className="h-4 w-4" />
                  {pending ? "Asking…" : "Enable notifications"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={dismiss}
                className="text-text-muted"
              >
                Not now
              </Button>
            </div>
            {error && (
              <p className="pt-1 text-xs text-danger-700">{error}</p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 -m-1 p-1 text-text-subtle hover:text-text rounded-input transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </section>

      {showInstallSheet && (
        <InstallInstructionsSheet onClose={() => setShowInstallSheet(false)} />
      )}
    </>
  );
}

function InstallInstructionsSheet({ onClose }: { onClose: () => void }) {
  const ios = typeof navigator !== "undefined" && isIOSSafari();
  // Lock body scroll while the sheet is open so the page underneath
  // doesn't scroll when the user touches the backdrop.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 pb-8 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong/70" />
        <h3 className="text-base font-semibold tracking-tight antialiased">
          Save Milo to your Home Screen
        </h3>
        <p className="mt-1 text-xs text-text-muted leading-relaxed">
          Adds a Milo icon next to your other apps. Tap it any time to open
          Milo without typing a URL.
        </p>
        <ol className="mt-4 space-y-3 text-sm">
          {ios ? (
            <>
              <li className="flex items-start gap-3">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white">
                  1
                </span>
                <span>
                  Tap the <Share className="inline h-4 w-4 align-text-bottom" />
                  {" "}Share button at the bottom of Safari.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white">
                  2
                </span>
                <span>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white">
                  3
                </span>
                <span>
                  Tap <strong>Add</strong> in the top-right. Milo lands on
                  your Home Screen — open it from there from now on.
                </span>
              </li>
            </>
          ) : (
            <>
              <li className="flex items-start gap-3">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white">
                  1
                </span>
                <span>
                  Open the browser menu (3-dot icon, top-right).
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white">
                  2
                </span>
                <span>
                  Tap <strong>Install app</strong> or{" "}
                  <strong>Add to Home Screen</strong>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white">
                  3
                </span>
                <span>
                  Confirm. Milo shows up alongside your other apps.
                </span>
              </li>
            </>
          )}
        </ol>
        <div className="mt-5 flex items-center justify-between gap-2">
          <p className="text-[11px] text-text-muted leading-relaxed">
            <Check className="inline h-3 w-3 text-success-700 align-text-bottom" />
            {" "}Once installed, come back to this banner to turn on
            notifications.
          </p>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}

// Chrome's BeforeInstallPromptEvent is non-standard; type it locally.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
