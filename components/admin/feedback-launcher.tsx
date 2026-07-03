"use client";

import * as React from "react";
import { Bug, X, Send } from "lucide-react";
import { usePathname } from "next/navigation";

/**
 * Floating "Report a bug" launcher. Pinned bottom-right of the admin
 * chrome — one click opens a dialog with kind / severity / message,
 * auto-attaches the current URL, user agent, viewport, and build SHA.
 * Submits to /api/feedback which writes to the app_feedback table and
 * emits a logger.info so the report shows up in the errors panel of
 * the Grafana dashboard.
 */
export function FeedbackLauncher() {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState<null | "ok" | string>(null);
  const [kind, setKind] = React.useState<"BUG" | "IDEA" | "OTHER">("BUG");
  const [severity, setSeverity] = React.useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [message, setMessage] = React.useState("");
  const pathname = usePathname() ?? "";

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    setPending(true);
    setDone(null);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          severity: kind === "BUG" ? severity : null,
          message,
          pageUrl: typeof window !== "undefined" ? window.location.href : pathname,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
          viewport:
            typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setDone((j as { error?: string }).error ?? "Failed to send");
        return;
      }
      setDone("ok");
      setMessage("");
      setTimeout(() => {
        setDone(null);
        setOpen(false);
      }, 1500);
    } catch {
      setDone("Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        // Mobile: rest above the fixed bottom tab bar (bar height +
        // home-indicator inset) so the launcher never hides behind the nav
        // and stays tappable. lg has no bottom bar, so it drops back to the
        // plain bottom-right resting position.
        // Icon-only 40px circle on phones; expands to a labelled pill at `sm`
        // — the SAME breakpoint the label turns on, so the fixed square never
        // has to hold text (was a circle→broken-pill collision from sm–lg).
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] right-3 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-700 text-brand-fg shadow-pop transition-colors hover:bg-brand-800 sm:h-9 sm:w-auto sm:gap-1.5 sm:px-3 sm:text-xs sm:font-medium lg:bottom-4 lg:right-4"
      >
        <Bug className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden />
        <span className="hidden sm:inline">Report bug</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report a bug"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md rounded-t-card sm:rounded-card bg-surface shadow-pop border border-border/70 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bug className="h-4 w-4 text-brand-700" aria-hidden />
                <h2 className="text-sm font-semibold tracking-tight">
                  Report a bug or idea
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(["BUG", "IDEA", "OTHER"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={
                    "h-9 rounded-md text-xs font-medium border " +
                    (kind === k
                      ? "bg-brand-50 text-brand-800 border-brand-200"
                      : "bg-surface text-text-muted border-border hover:bg-surface-2")
                  }
                >
                  {k === "BUG" ? "Bug" : k === "IDEA" ? "Idea" : "Other"}
                </button>
              ))}
            </div>

            {kind === "BUG" && (
              <div>
                <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                  Severity
                </label>
                <div className="grid grid-cols-4 gap-1.5 mt-1">
                  {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeverity(s)}
                      className={
                        "h-8 rounded-md text-[11px] font-medium border " +
                        (severity === s
                          ? "bg-brand-50 text-brand-800 border-brand-200"
                          : "bg-surface text-text-muted border-border hover:bg-surface-2")
                      }
                    >
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                What happened?
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={4000}
                placeholder="What's broken, what did you expect, what did you see instead?"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
              />
            </div>

            <p className="text-[11px] text-text-subtle">
              Auto-attached: current URL, browser, viewport size, build SHA.
            </p>

            {done === "ok" ? (
              <p className="text-xs text-brand-800">Thanks — logged.</p>
            ) : done ? (
              <p className="text-xs text-danger-700">{done}</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 px-3 rounded-md text-xs text-text-muted hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || message.trim().length === 0}
                className="h-9 px-3 rounded-md bg-brand-700 text-brand-fg text-xs font-medium hover:bg-brand-800 disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                {pending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
