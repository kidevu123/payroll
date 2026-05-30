"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function EmployeesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("employees route error", error);
  }, [error]);

  return (
    <div className="max-w-lg mx-auto space-y-4 rounded-card border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-text-muted">
        The employees page failed to load in your browser. After a deploy,
        try a hard refresh (Cmd+Shift+R or Ctrl+Shift+R) to clear cached
        scripts, then open this page again.
      </p>
      {error.digest && (
        <p className="text-xs font-mono text-text-subtle">
          Reference: {error.digest}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          Hard reload
        </Button>
      </div>
    </div>
  );
}
