"use client";

import * as React from "react";
import { cancelPollAction } from "@/app/(admin)/payroll/actions";

const WATCH_KEY = "payroll:poll-watch";
const POLL_MS = 2_000;
const QUEUED_WARN_MS = 30_000;
const AUTO_DISMISS_MS = 45_000;

export type PollStatusResponse = {
  id: string | null;
  phase: "idle" | "running" | "succeeded" | "failed" | "stuck";
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean;
  triggeredBy: string | null;
  pairsInserted: number | null;
  pairsUpdated: number | null;
  eventsScraped: number | null;
  errorMessage: string | null;
  elapsedMs: number | null;
};

type WatchState = {
  triggeredAt: string;
  label: string;
};

type PollStatusContextValue = {
  startWatching: (label: string) => void;
  status: PollStatusResponse | null;
  visible: boolean;
  dismiss: () => void;
  /** Force-kill the running poll (server-side) and refresh status. */
  cancel: () => void;
  watch: WatchState | null;
  /** True while a poll is queued, running, or stuck. */
  isActive: boolean;
};

const PollStatusContext = React.createContext<PollStatusContextValue | null>(
  null,
);

function readWatch(): WatchState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WATCH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WatchState;
  } catch {
    return null;
  }
}

function writeWatch(state: WatchState | null) {
  if (typeof window === "undefined") return;
  if (!state) sessionStorage.removeItem(WATCH_KEY);
  else sessionStorage.setItem(WATCH_KEY, JSON.stringify(state));
}

function formatElapsed(ms: number | null): string {
  if (ms == null) return "";
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
}

function matchesWatch(
  watch: WatchState,
  status: PollStatusResponse,
): boolean {
  if (!status.startedAt) return false;
  const watchMs = new Date(watch.triggeredAt).getTime();
  const startedMs = new Date(status.startedAt).getTime();
  // Worker may start a few seconds after queue; allow a small lead.
  return startedMs >= watchMs - 5_000;
}

function deriveUi(
  watch: WatchState | null,
  status: PollStatusResponse | null,
): {
  show: boolean;
  phase: PollStatusResponse["phase"] | "queued";
  title: string;
  detail: string | null;
  progress: "indeterminate" | "success" | "error" | "idle";
} {
  if (!status) {
    if (!watch) {
      return {
        show: false,
        phase: "idle",
        title: "",
        detail: null,
        progress: "idle",
      };
    }
    const waitingMs = Date.now() - new Date(watch.triggeredAt).getTime();
    if (waitingMs > QUEUED_WARN_MS) {
      return {
        show: true,
        phase: "queued",
        title: `${watch.label} — waiting for worker`,
        detail:
          "Job is queued but hasn't started yet. Check that pg-boss is running (/api/health).",
        progress: "indeterminate",
      };
    }
    return {
      show: true,
      phase: "queued",
      title: `${watch.label} — queued`,
      detail: "Starting background poll…",
      progress: "indeterminate",
    };
  }

  const tracked = watch ? matchesWatch(watch, status) : false;
  const running = status.phase === "running";

  if (!tracked && !running) {
    return {
      show: false,
      phase: status.phase,
      title: "",
      detail: null,
      progress: "idle",
    };
  }

  if (running || (tracked && !status.finishedAt)) {
    const longRun = (status.elapsedMs ?? 0) > 5 * 60 * 1000;
    return {
      show: true,
      phase: "running",
      title: `${watch?.label ?? "NGTeco punch poll"} — running`,
      detail: longRun
        ? `Still polling NGTeco (${formatElapsed(status.elapsedMs)}). A same-day poll is killed after 10 min; if this keeps running, Stop poll and use Backfill missing days.`
        : `Pulling today's punches from NGTeco (${formatElapsed(status.elapsedMs)}) — usually under a minute via the API`,
      progress: "indeterminate",
    };
  }

  if (status.phase === "stuck") {
    return {
      show: true,
      phase: "stuck",
      title: `${watch?.label ?? "NGTeco punch poll"} — may be stuck`,
      detail:
        status.errorMessage ??
        "Poll started but hasn't finished in 15+ minutes. Check server logs.",
      progress: "error",
    };
  }

  if (status.phase === "succeeded") {
    const parts: string[] = [];
    if (status.pairsInserted != null) parts.push(`${status.pairsInserted} new`);
    if (status.pairsUpdated != null && status.pairsUpdated > 0) {
      parts.push(`${status.pairsUpdated} updated`);
    }
    return {
      show: true,
      phase: "succeeded",
      title: `${watch?.label ?? "NGTeco punch poll"} — complete`,
      detail:
        parts.length > 0
          ? `${parts.join(", ")} · ${formatElapsed(status.elapsedMs)}`
          : `No new punches · ${formatElapsed(status.elapsedMs)}`,
      progress: "success",
    };
  }

  return {
    show: true,
    phase: "failed",
    title: `${watch?.label ?? "NGTeco punch poll"} — failed`,
    detail:
      status.errorMessage ??
      "Poll finished with an error. Check Settings → NGTeco or server logs.",
    progress: "error",
  };
}

export function PollStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [watch, setWatch] = React.useState<WatchState | null>(null);
  const [status, setStatus] = React.useState<PollStatusResponse | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const fetchStatus = React.useCallback(async () => {
    try {
      const resp = await fetch("/api/ngteco/poll/status", {
        cache: "no-store",
      });
      if (!resp.ok) return;
      const json = (await resp.json()) as PollStatusResponse;
      setStatus(json);
      return json;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    setWatch(readWatch());
    void fetchStatus();
  }, [fetchStatus]);

  React.useEffect(() => {
    const shouldPoll =
      !!watch ||
      status?.phase === "running" ||
      status?.phase === "stuck";

    if (!shouldPoll) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    pollRef.current = setInterval(() => {
      void fetchStatus();
    }, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [watch, status?.phase, fetchStatus]);

  React.useEffect(() => {
    if (!watch || !status) return;
    if (!matchesWatch(watch, status)) return;
    if (
      status.phase === "succeeded" ||
      status.phase === "failed" ||
      status.phase === "stuck"
    ) {
      writeWatch(null);
      setWatch(null);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        setDismissed(true);
      }, AUTO_DISMISS_MS);
    }
  }, [watch, status]);

  const startWatching = React.useCallback((label: string) => {
    const next = { triggeredAt: new Date().toISOString(), label };
    writeWatch(next);
    setWatch(next);
    setDismissed(false);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    void fetchStatus();
  }, [fetchStatus]);

  const dismiss = React.useCallback(() => {
    writeWatch(null);
    setWatch(null);
    setDismissed(true);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  const cancel = React.useCallback(() => {
    // Fire-and-forget the server-side kill, then refresh so the bar reflects
    // the cancelled/failed state instead of spinning forever.
    void cancelPollAction()
      .catch(() => undefined)
      .then(() => fetchStatus());
  }, [fetchStatus]);

  const visible = !dismissed && deriveUi(watch, status).show;
  const isActive =
    visible ||
    status?.phase === "running" ||
    status?.phase === "stuck" ||
    (!!watch &&
      status?.phase !== "succeeded" &&
      status?.phase !== "failed");

  const value = React.useMemo(
    () => ({
      startWatching,
      status,
      visible,
      dismiss,
      cancel,
      watch,
      isActive,
    }),
    [startWatching, status, visible, dismiss, cancel, watch, isActive],
  );

  return (
    <PollStatusContext.Provider value={value}>
      {children}
    </PollStatusContext.Provider>
  );
}

export function usePollStatus(): PollStatusContextValue {
  const ctx = React.useContext(PollStatusContext);
  if (!ctx) {
    throw new Error("usePollStatus must be used within PollStatusProvider");
  }
  return ctx;
}

/** Read-only last poll snapshot for inline button labels. */
export function usePollLastLabel(initial: {
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean;
  errorMessage: string | null;
} | null) {
  const { status } = usePollStatus();
  const last = status?.startedAt
    ? {
        startedAt: status.startedAt,
        finishedAt: status.finishedAt,
        ok: status.ok,
        errorMessage: status.errorMessage,
      }
    : initial;

  if (!last?.startedAt) return "never";

  const inProgress = !last.finishedAt;
  const rel = formatRelative(last.startedAt);
  if (inProgress) return `running · started ${rel}`;
  if (last.ok) return rel;
  return `${rel} · failed`;
}
