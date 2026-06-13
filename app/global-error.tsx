"use client";

import * as React from "react";

const RELOAD_ONCE = "milo.deploy.reload-once";

/**
 * Last-resort client error surface. Offers a one-tap reload — often enough
 * after a deploy when cached JS no longer matches the server.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Global client error:", error);
  }, [error]);

  const hardReload = () => {
    sessionStorage.removeItem(RELOAD_ONCE);
    window.location.reload();
  };

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: "#fafafa",
          color: "#18181b",
        }}
      >
        <main style={{ maxWidth: "22rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Milo needs a refresh
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "#52525b", margin: "0 0 1.25rem" }}>
            The app was updated or cached files are out of date. Reload to continue.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={hardReload}
              style={{
                padding: "0.625rem 1rem",
                borderRadius: "0.5rem",
                border: "none",
                background: "#0f766e",
                color: "#fff",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "0.625rem 1rem",
                borderRadius: "0.5rem",
                border: "1px solid #e4e4e7",
                background: "#fff",
                color: "#18181b",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
