"use client";

// Auto sign-out for the shared kiosk, hardened for real kiosk browsers.
//
// The naive version decremented a counter once per second — but kiosk
// browsers FREEZE timers when the screen sleeps or the tab is hidden.
// The countdown would stall at e.g. 30s and the next person's wake-up
// touch reset it, leaving the previous session alive indefinitely.
//
// This version anchors on wall-clock time (lastActivity timestamp):
// - every tick/wake/touch computes the TRUE elapsed idle time;
// - a touch that arrives after the deadline signs out instead of
//   resetting;
// - visibilitychange/pageshow/focus (screen wake, bfcache restore) run
//   the check immediately, before the wake-up touch can matter.
// Navigation is done client-side via the router — a redirect() thrown
// inside a directly-invoked server action is not reliably honored by
// kiosk webviews.

import * as React from "react";
import { useRouter } from "next/navigation";
import { kioskClearSessionAction } from "../actions";

export function KioskIdleWatcher({
  idleSeconds,
  label,
}: {
  idleSeconds: number;
  label: string;
}) {
  const router = useRouter();
  const [remaining, setRemaining] = React.useState(idleSeconds);
  const lastActivityRef = React.useRef(Date.now());
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    const logout = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      void (async () => {
        try {
          await kioskClearSessionAction();
        } finally {
          router.replace("/kiosk");
          router.refresh();
        }
      })();
    };

    const elapsedS = () => (Date.now() - lastActivityRef.current) / 1000;

    const check = () => {
      if (firedRef.current) return;
      const rem = Math.max(0, idleSeconds - elapsedS());
      setRemaining(Math.ceil(rem));
      if (rem <= 0) logout();
    };

    const activity = () => {
      if (firedRef.current) return;
      // A touch AFTER the deadline (frozen timer, screen was asleep)
      // must end the stale session, not revive it.
      if (elapsedS() >= idleSeconds) {
        logout();
        return;
      }
      lastActivityRef.current = Date.now();
      setRemaining(idleSeconds);
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    const wakeEvents: (keyof WindowEventMap)[] = ["pageshow", "focus"];
    for (const e of activityEvents)
      window.addEventListener(e, activity, { passive: true });
    for (const e of wakeEvents)
      window.addEventListener(e, check, { passive: true });
    document.addEventListener("visibilitychange", check);
    const tick = window.setInterval(check, 1000);
    check();
    return () => {
      for (const e of activityEvents) window.removeEventListener(e, activity);
      for (const e of wakeEvents) window.removeEventListener(e, check);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(tick);
    };
  }, [idleSeconds, router]);

  return (
    <p
      className={
        remaining <= 15
          ? "text-base font-semibold text-danger-700"
          : "text-base text-text-muted"
      }
    >
      {label} {remaining}s
    </p>
  );
}
