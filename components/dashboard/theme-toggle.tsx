"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { DASH } from "./theme";

/**
 * Light/dark switch for the admin chrome. The theme class lives on
 * `#admin-root` (set server-side from the `milo-theme` cookie); this toggle
 * flips that class instantly for a no-reload switch and persists the choice
 * in the cookie so the server renders the right theme on the next load.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = React.useState(true);

  // Sync the initial visual state from the DOM the server rendered.
  React.useEffect(() => {
    const root = document.getElementById("admin-root");
    setIsDark(root?.classList.contains("dark") ?? true);
  }, []);

  const toggle = () => {
    const root = document.getElementById("admin-root");
    if (!root) return;
    const next = !root.classList.contains("dark");
    root.classList.toggle("dark", next);
    setIsDark(next);
    // Persist for the next server render (1 year).
    document.cookie = `milo-theme=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${className ?? ""}`}
      style={{
        color: DASH.textMuted,
        background: DASH.surfaceRaised,
        border: `1px solid ${DASH.border}`,
      }}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
