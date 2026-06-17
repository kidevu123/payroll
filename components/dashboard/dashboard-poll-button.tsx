"use client";

// "Poll now" pill for the dashboard automation banner. Fires the real
// NGTeco poll (pollNowAction) and starts the global PollStatusBar watcher —
// it does NOT navigate to settings. Matches the banner's gradient pill.

import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { pollNowAction } from "@/app/(admin)/payroll/actions";
import { usePollStatus } from "@/components/admin/poll-status-provider";

export function DashboardPollButton() {
  const { startWatching, isActive } = usePollStatus();
  const [busy, setBusy] = React.useState(false);
  const inProgress = busy || isActive;

  async function onClick() {
    if (inProgress) return;
    setBusy(true);
    try {
      const r = await pollNowAction();
      if (r && "ok" in r) startWatching("Poll punches");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={inProgress}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-70"
      style={{
        color: "#0b0b12",
        background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
        boxShadow: "0 8px 20px -10px rgba(124,58,237,0.7)",
      }}
    >
      {inProgress ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Polling…
        </>
      ) : (
        <>
          Poll now
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </>
      )}
    </button>
  );
}
