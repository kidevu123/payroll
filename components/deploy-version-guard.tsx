"use client";

import * as React from "react";

const STORAGE_SHA = "milo.deploy.sha";
const RELOAD_ONCE = "milo.deploy.reload-once";

const BUILD_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "dev";

function shouldRecoverFromError(message: string) {
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Server Action|older or newer deployment|Failed to find Server Action/i.test(
    message,
  );
}

function reloadOnce() {
  if (sessionStorage.getItem(RELOAD_ONCE)) return false;
  sessionStorage.setItem(RELOAD_ONCE, "1");
  window.location.reload();
  return true;
}

/**
 * After rapid deploys, PWAs can keep stale `_next` chunks while the server
 * serves a new build — that mismatch throws on load. Compare the baked-in
 * git SHA to localStorage and hard-reload once when it changes; also catch
 * chunk / server-action errors and retry once.
 */
export function DeployVersionGuard() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;

    const storedSha = localStorage.getItem(STORAGE_SHA);
    if (storedSha && storedSha !== BUILD_SHA) {
      localStorage.setItem(STORAGE_SHA, BUILD_SHA);
      reloadOnce();
      return;
    }

    localStorage.setItem(STORAGE_SHA, BUILD_SHA);
    sessionStorage.removeItem(RELOAD_ONCE);

    const onError = (event: ErrorEvent) => {
      const message = event.message ?? "";
      if (!shouldRecoverFromError(message)) return;
      reloadOnce();
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "";
      if (!shouldRecoverFromError(message)) return;
      reloadOnce();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
