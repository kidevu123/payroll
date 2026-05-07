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
  try {
    const summary = await handlePunchPoll(opts.pollOptions ?? {});
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
