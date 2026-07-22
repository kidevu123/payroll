"use client";

// Auto sign-out for the shared kiosk: any touch/keypress resets the
// clock; hitting zero clears the session cookie and navigates back to
// the PIN screen. Navigation is done client-side via the router — a
// redirect() thrown inside a directly-invoked server action is not
// reliably honored by every kiosk browser/webview, which is exactly
// where this runs.

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
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    const reset = () => {
      if (!firedRef.current) setRemaining(idleSeconds);
    };
    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    const tick = window.setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, reset);
      window.clearInterval(tick);
    };
  }, [idleSeconds]);

  React.useEffect(() => {
    if (remaining === 0 && !firedRef.current) {
      firedRef.current = true;
      void (async () => {
        try {
          await kioskClearSessionAction();
        } finally {
          router.replace("/kiosk");
          router.refresh();
        }
      })();
    }
  }, [remaining, router]);

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
