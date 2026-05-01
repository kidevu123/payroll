"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Calls router.refresh() on a fixed interval. Used by /me/time so the
 * "Today" card picks up new punches from the NGTeco poll without a
 * full reload. Defaults to 60s so the rate stays gentle on the worker.
 */
export function AutoRefresh({
  intervalMs = 60_000,
  label = "Auto-refresh",
}: {
  intervalMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [lastTick, setLastTick] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setLastTick(new Date());
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
      <RefreshCw className="h-3 w-3" aria-hidden />
      <span>
        {label} · every {Math.round(intervalMs / 1000)}s
        {lastTick ? ` · ${lastTick.toLocaleTimeString()}` : ""}
      </span>
    </span>
  );
}
