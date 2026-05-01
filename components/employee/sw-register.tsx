"use client";

import * as React from "react";

export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const url = "/sw.js";
    navigator.serviceWorker.register(url).catch((err) => {
      // Best-effort; log to console for the developer, not throw.
      console.warn("ServiceWorker registration failed:", err);
    });
  }, []);
  return null;
}
