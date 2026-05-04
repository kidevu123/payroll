// punch.poll handler — runs on a short cron (configurable, default every
// 15 min). Scrapes NGTeco's View Attendance Punch view, pairs the events
// into in/out per employee per day, and upserts into punches.
//
// Heavy dependencies (playwright scraper, importer) are dynamic-imported.
// The reason: lib/jobs/index.ts is reachable from instrumentation.ts via
// dynamic import, and webpack pulls Playwright + db deps into the chunk
// otherwise. The vault module is small (only node:crypto, externalized
// via serverExternalPackages) so it imports statically — earlier we used
// a webpackIgnore relative-path dynamic-import which broke when called
// from server-action chunks (different chunk dir, ENOENT).
//
// Path stability rule: every dynamic import here uses the @/-alias so
// resolution doesn't depend on the calling chunk's directory.

import { logger } from "@/lib/telemetry";
import { getSetting } from "@/lib/settings/runtime";
import { open as openSealed } from "@/lib/crypto/vault";

function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" && value !== null &&
    "ciphertext" in value && "iv" in value
  );
}

/**
 * ISO timestamp for Monday 00:00 of the current week in `tz`. Used as a
 * lower bound when filtering scraped NGTeco events down to "this week
 * only". Returned in the form scraper events use ("YYYY-MM-DDTHH:mm:ss"
 * with a tz offset) so a string comparison is well-defined.
 */
function mondayOfThisWeekIso(tz: string): string {
  // Resolve "today's calendar date" in the company tz so a near-midnight
  // call doesn't pick yesterday.
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
    new Date(),
  );
  // todayStr is "YYYY-MM-DD" in tz. Compute weekday using a UTC-noon
  // anchor so DST doesn't shift it across midnight.
  const today = new Date(`${todayStr}T12:00:00Z`);
  // 0=Sun, 1=Mon ... 6=Sat. Map to days-since-Monday in [0..6].
  const dow = today.getUTCDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  const mondayStr = monday.toISOString().slice(0, 10);
  return `${mondayStr}T00:00:00`;
}

export type PollSummary = {
  ok: boolean;
  /** "skipped because creds missing", challenge, scrape failure, etc. */
  reason?: string;
  eventsScraped?: number;
  pairsInserted?: number;
  pairsUpdated?: number;
  unmatchedRefs?: number;
  openShifts?: number;
  durationMs?: number;
  /** When set, callers (esp. the manual button) can show the screenshot link. */
  screenshotPath?: string;
};

export async function handlePunchPoll(): Promise<PollSummary> {
  const ngteco = await getSetting("ngteco").catch(() => null);
  const company = await getSetting("company").catch(() => null);
  if (!ngteco || !company) {
    logger.info("punch.poll: settings unavailable; skipping");
    return { ok: false, reason: "settings unavailable" };
  }
  if (
    !isEnvelope(ngteco.usernameEncrypted) ||
    !isEnvelope(ngteco.passwordEncrypted)
  ) {
    logger.info("punch.poll: NGTeco credentials not configured; skipping");
    return { ok: false, reason: "NGTeco credentials not configured" };
  }
  const runId = `poll-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  // Stable @/-aliased dynamic imports — resolve the same regardless of
  // which chunk calls handlePunchPoll (cron worker vs server action).
  // Playwright + db deps stay out of the eager bundle because the import
  // is lazy.
  const scraperMod = await import("@/lib/ngteco/scraper");
  const importerMod = await import("@/lib/punches/poll-importer");
  const {
    scrapeViewAttendance,
    ChallengeDetectedError,
    ScrapeFailure,
  } = scraperMod;
  const { importPunchPoll } = importerMod;

  const username = openSealed(ngteco.usernameEncrypted);
  const password = openSealed(ngteco.passwordEncrypted);

  try {
    const result = await scrapeViewAttendance({
      portalUrl: ngteco.portalUrl,
      username,
      password,
      headless: ngteco.headless,
      runId,
    });
    logger.info(
      { runId, events: result.events.length, durationMs: result.durationMs },
      "punch.poll: scrape ok",
    );
    if (result.events.length === 0) {
      return {
        ok: true,
        eventsScraped: 0,
        pairsInserted: 0,
        pairsUpdated: 0,
        durationMs: result.durationMs,
      };
    }
    // Per owner directive: poll only emits punches from THIS week (Monday
    // 00:00 → next Monday 00:00 in company tz). Older events scraped
    // from NGTeco's "View Attendance Punch" view are dropped at this
    // boundary — existing rows already in the database stay untouched
    // (the importer's ON CONFLICT DO NOTHING preserves prior data).
    const weekStartIso = mondayOfThisWeekIso(company.timezone);
    const filtered = result.events.filter(
      (e) => e.punchAt >= weekStartIso,
    );
    logger.info(
      {
        runId,
        scraped: result.events.length,
        thisWeek: filtered.length,
        weekStartIso,
      },
      "punch.poll: window-filtered to current week",
    );
    const summary = await importPunchPoll(filtered, {
      timezone: company.timezone,
    });
    logger.info({ runId, ...summary }, "punch.poll: import done");
    // Best-effort retention prune: keep poll log rows ≤90 days. Skipped
    // on failure (no point pruning when the poll itself blew up).
    try {
      const { prunePollLog } = await import("@/lib/db/queries/poll-history");
      const pruned = await prunePollLog(90);
      if (pruned > 0) {
        logger.info({ runId, pruned }, "punch.poll: poll-log pruned");
      }
    } catch (err) {
      logger.warn(
        { runId, err: err instanceof Error ? err.message : String(err) },
        "punch.poll: poll-log prune failed (non-fatal)",
      );
    }
    return {
      ok: true,
      eventsScraped: result.events.length,
      pairsInserted: summary.pairsInserted,
      pairsUpdated: summary.pairsUpdated,
      unmatchedRefs: summary.unmatchedRefs,
      openShifts: summary.openShifts,
      durationMs: result.durationMs,
    };
  } catch (err) {
    if (err instanceof ChallengeDetectedError) {
      logger.warn({ runId, kind: err.kind }, "punch.poll: challenge detected");
      return { ok: false, reason: `challenge: ${err.kind}` };
    }
    if (err instanceof ScrapeFailure) {
      logger.error(
        { runId, msg: err.message, screenshot: err.artifacts.screenshotPath },
        "punch.poll: scrape failure",
      );
      return {
        ok: false,
        reason: err.message,
        ...(err.artifacts.screenshotPath
          ? { screenshotPath: err.artifacts.screenshotPath }
          : {}),
      };
    }
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ runId, err: reason }, "punch.poll: unexpected error");
    return { ok: false, reason };
  }
}
