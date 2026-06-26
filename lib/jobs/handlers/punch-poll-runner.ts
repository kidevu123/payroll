// Wrapper that runs handlePunchPoll() with start/finish logging into
// ngteco_poll_log. Used by:
//   - the scheduled cron worker (lib/jobs/index.ts)
//   - the manual "Poll Now" admin action (app/(admin)/payroll/actions.ts)
//
// Lives here rather than inside the handler module so the cron's worker
// chunk doesn't pull a transitive dependency on the db query layer until
// it runs — the dynamic-import gymnastics in punch-poll.ts depend on the
// handler module staying small.

import {
  logger,
  ngtecoPollRuns,
  ngtecoScrapeDuration,
  punchesImported,
} from "@/lib/telemetry";
import {
  finishPoll,
  startPoll,
} from "@/lib/db/queries/poll-history";
import {
  handlePunchPoll,
  type PollOptions,
  type PollSummary,
} from "./punch-poll";

// Hard ceilings on a single scrape. A healthy poll finishes in ~1-2 min;
// these exist so a stalled Playwright step can never run forever. They are
// deliberately shorter than the pg-boss job expiry so the browser is killed
// (below) BEFORE pg-boss abandons the job and the next cron tick starts a
// sibling - that race is what orphaned 16 chrome processes in the wild.
const HARD_TIMEOUT_TODAY_MS = 10 * 60 * 1000;
const HARD_TIMEOUT_BACKFILL_MS = 30 * 60 * 1000;

/**
 * Run `fn`, but reject if it outlives `ms`. On timeout the spawned headless
 * Chrome is force-killed so the abandoned scrape cannot keep a browser (and
 * its ~1.3 GB of RAM) alive. The underlying promise cannot be cancelled, but
 * killing its browser makes its next Playwright call throw and settle it.
 */
async function withHardTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void import("@/lib/ngteco/chromium-reaper").then((m) => m.killAllChromium());
      reject(
        new Error(
          `Poll exceeded hard timeout (${Math.round(ms / 60000)} min); browser killed. Use Backfill missing days to recover.`,
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([fn(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runPollAndLog(opts: {
  triggeredBy: "CRON" | "MANUAL";
  triggeredById?: string | null;
  /** Pass through to handlePunchPoll. Used by the backfill action; the
   *  cron + the "Poll punches now" button leave it undefined for the
   *  fast today-only path. */
  pollOptions?: PollOptions;
}): Promise<PollSummary> {
  const log = await startPoll({
    triggeredBy: opts.triggeredBy,
    triggeredById: opts.triggeredById ?? null,
  });
  const t0 = Date.now();
  // Backfills legitimately page back through weeks of data; today-only polls
  // should never need more than a few minutes.
  const daysBack = opts.pollOptions?.daysBack ?? 0;
  // CRON polls can auto-widen their window (auto-backfill of recent days), so
  // they get the generous backfill timeout too — otherwise a legitimately wider
  // cron run gets hard-killed under the short today-only ceiling.
  const hardTimeoutMs =
    daysBack > 1 || opts.triggeredBy === "CRON"
      ? HARD_TIMEOUT_BACKFILL_MS
      : HARD_TIMEOUT_TODAY_MS;
  try {
    const summary = await withHardTimeout(
      () => handlePunchPoll(opts.pollOptions ?? {}),
      hardTimeoutMs,
    );
    await finishPoll(log.id, {
      ok: summary.ok,
      ...(summary.eventsScraped !== undefined ? { eventsScraped: summary.eventsScraped } : {}),
      ...(summary.pairsInserted !== undefined ? { pairsInserted: summary.pairsInserted } : {}),
      ...(summary.pairsUpdated !== undefined ? { pairsUpdated: summary.pairsUpdated } : {}),
      ...(summary.reason ? { errorMessage: summary.reason } : {}),
    });
    ngtecoPollRuns.add(1, {
      outcome: summary.ok ? "ok" : "fail",
      trigger: opts.triggeredBy,
    });
    ngtecoScrapeDuration.record(Date.now() - t0, {
      outcome: summary.ok ? "ok" : "fail",
    });
    if (summary.pairsInserted) {
      punchesImported.add(summary.pairsInserted, { kind: "inserted" });
    }
    if (summary.pairsUpdated) {
      punchesImported.add(summary.pairsUpdated, { kind: "updated" });
    }
    return summary;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, source: "ngteco.punch.poll" }, "punch.poll: runner caught unexpected throw");
    await finishPoll(log.id, { ok: false, errorMessage: reason });
    ngtecoPollRuns.add(1, { outcome: "fail", trigger: opts.triggeredBy });
    ngtecoScrapeDuration.record(Date.now() - t0, { outcome: "fail" });
    return { ok: false, reason };
  }
}
