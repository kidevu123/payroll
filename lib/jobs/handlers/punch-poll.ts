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
 * ISO timestamp for 00:00 (midnight) of TODAY's calendar date in `tz`.
 * Used as the lower bound when filtering scraped NGTeco events. Owner
 * directive: poll runs multiple times a day; each poll only ingests
 * today's punches. Yesterday's data is locked in by the time we move on.
 *
 * Returned in the form scraper events use ("YYYY-MM-DDTHH:mm:ss"
 * with a tz offset truncated). String compare against punchAt which
 * has the form "YYYY-MM-DDTHH:mm:ss-04:00" — works because the date
 * portion is identical-prefix when "today" matches and lex-greater
 * when "today" is later.
 */
function startOfTodayIso(tz: string): string {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
    new Date(),
  );
  return `${todayStr}T00:00:00`;
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
    // Per owner directive: each poll only ingests TODAY's punches. The
    // poll runs multiple times a day, so yesterday's data is locked in
    // by the time we hit a new calendar day. Older events scraped from
    // NGTeco's "View Attendance Punch" view are dropped at this
    // boundary — existing rows in the database stay untouched.
    //
    // Mid-day re-entry is handled fully by the importer:
    //   - Each pair (in→out) is hashed on (employeeId, in-event-timestamp).
    //   - Existing rows with the same hash get their clock_out updated
    //     (handles the "morning poll saw open shift, lunch poll sees
    //     closed shift" case).
    //   - A second pair (employee left for lunch, came back) gets its
    //     own hash from the second IN event's timestamp — separate row.
    //   - Concurrent polls racing the same insert hit a 23505 unique
    //     violation and skip silently (importer try/catch).
    // Net: poll twice a day, ten times a day, no duplicate rows ever
    // accumulate. The unique partial index on punches.ngteco_record_hash
    // is the de-dupe contract.
    const todayStartIso = startOfTodayIso(company.timezone);
    const filtered = result.events.filter(
      (e) => e.punchAt >= todayStartIso,
    );
    logger.info(
      {
        runId,
        scraped: result.events.length,
        today: filtered.length,
        todayStartIso,
      },
      "punch.poll: window-filtered to today",
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
