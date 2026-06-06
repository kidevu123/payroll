// GET /api/ngteco/poll/status — polling endpoint for punch poll progress.
// Mirrors /api/ngteco/runs/[runId]/status but reads ngteco_poll_log.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { getLastPoll } from "@/lib/db/queries/poll-history";

const STUCK_MS = 15 * 60 * 1000;

export type PollPhase =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "stuck";

export async function GET(): Promise<Response> {
  await requireAdmin();
  const last = await getLastPoll();
  if (!last) {
    return NextResponse.json({
      id: null,
      phase: "idle" as PollPhase,
      startedAt: null,
      finishedAt: null,
      ok: false,
      triggeredBy: null,
      pairsInserted: null,
      pairsUpdated: null,
      eventsScraped: null,
      errorMessage: null,
      elapsedMs: null,
    });
  }

  const now = Date.now();
  const startedMs = last.startedAt.getTime();
  const elapsedMs = last.finishedAt
    ? last.finishedAt.getTime() - startedMs
    : now - startedMs;

  let phase: PollPhase = "idle";
  if (!last.finishedAt) {
    phase = elapsedMs > STUCK_MS ? "stuck" : "running";
  } else if (last.ok) {
    phase = "succeeded";
  } else {
    phase = "failed";
  }

  return NextResponse.json({
    id: last.id,
    phase,
    startedAt: last.startedAt.toISOString(),
    finishedAt: last.finishedAt?.toISOString() ?? null,
    ok: last.ok,
    triggeredBy: last.triggeredBy,
    pairsInserted: last.pairsInserted,
    pairsUpdated: last.pairsUpdated,
    eventsScraped: last.eventsScraped,
    errorMessage: last.errorMessage,
    elapsedMs,
  });
}
