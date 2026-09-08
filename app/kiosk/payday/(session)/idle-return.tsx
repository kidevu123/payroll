"use client";

// A signing screen left alone (employee walked off mid-signature) returns
// to the names list so the next person never sees the previous person's
// pay. Wall-clock anchored like the kiosk idle watcher.

import * as React from "react";
import { useRouter } from "next/navigation";

export function PaydayIdleReturn({ idleSeconds }: { idleSeconds: number }) {
  const router = useRouter();
  const lastRef = React.useRef(Date.now());
  React.useEffect(() => {
    const activity = () => {
      lastRef.current = Date.now();
    };
    const check = () => {
      if ((Date.now() - lastRef.current) / 1000 >= idleSeconds) {
        router.replace("/kiosk/payday/list");
      }
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "pointermove", "keydown", "touchstart"];
    for (const e of events) window.addEventListener(e, activity, { passive: true });
    document.addEventListener("visibilitychange", check);
    const tick = window.setInterval(check, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, activity);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(tick);
    };
  }, [idleSeconds, router]);
  return null;
}
