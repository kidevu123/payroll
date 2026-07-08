"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestMyTimeOffCancellationAction } from "./time-off/new/actions";

export function RequestTimeOffCancellationButton({
  requestId,
  label,
  confirmText,
}: {
  requestId: string;
  label: string;
  confirmText: string;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="inline-flex items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={async () => {
          if (!confirm(confirmText)) return;
          setPending(true);
          setError(null);
          try {
            const result = await requestMyTimeOffCancellationAction(requestId);
            if (result?.error) setError(result.error);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Request failed.");
          } finally {
            setPending(false);
          }
        }}
      >
        <X className="h-3.5 w-3.5" />
        {pending ? "..." : label}
      </Button>
      {error ? (
        <span className="max-w-[160px] truncate text-[11px] text-danger-700" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
