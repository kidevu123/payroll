"use client";

// Auto sign-out for the shared kiosk: any touch/keypress resets the
// clock; hitting zero calls the logout action. The remaining time is
// always visible so nobody is surprised.

import * as React from "react";
import { kioskLogoutAction } from "../actions";

export function KioskIdleWatcher({
  idleSeconds,
  label,
}: {
  idleSeconds: number;
  label: string;
}) {
  const [remaining, setRemaining] = React.useState(idleSeconds);
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    const reset = () => setRemaining(idleSeconds);
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
      void kioskLogoutAction();
    }
  }, [remaining]);

  return (
    <p
      className={
        remaining <= 15
          ? "text-base font-semibold text-red-700"
          : "text-base text-neutral-500"
      }
    >
      {label} {remaining}s
    </p>
  );
}
