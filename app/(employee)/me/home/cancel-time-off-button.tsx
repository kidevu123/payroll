"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cancelMyTimeOffAction } from "./time-off/new/actions";

/** Lightweight client wrapper around the cancel action. Renders a
 *  tiny X button next to a PENDING request — the employee can
 *  rescind a click-mistake without bothering an admin. We confirm
 *  before firing because cancel is irreversible from the employee
 *  side (admin still has the row in the audit log). */
export function CancelTimeOffButton({
  requestId,
  confirmText,
}: {
  requestId: string;
  confirmText: string;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="inline-flex items-center gap-1.5">
      {error && (
        <span
          className="text-[10px] text-red-700 truncate max-w-[140px]"
          title={error}
        >
          {error}
        </span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (!confirm(confirmText)) return;
          setPending(true);
          setError(null);
          try {
            const r = await cancelMyTimeOffAction(requestId);
            if (r && "error" in r && r.error) setError(r.error);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Cancel failed.",
            );
          } finally {
            setPending(false);
          }
        }}
        title="Cancel this request"
        className="inline-flex items-center justify-center h-6 w-6 rounded-md border border-border/70 bg-surface text-text-muted hover:text-red-700 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
