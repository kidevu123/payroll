"use client";

import * as React from "react";

const RELOAD_ONCE = "milo.deploy.reload-once";

function reloadOnce() {
  if (sessionStorage.getItem(RELOAD_ONCE)) return;
  sessionStorage.setItem(RELOAD_ONCE, "1");
  window.location.reload();
}

export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onControllerChange = () => reloadOnce();
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_ACTIVATED") reloadOnce();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      })
      .catch((err) => {
        console.warn("ServiceWorker registration failed:", err);
      });

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
