// punch.poll handler — runs on a short cron (configurable, default every
// 15 min). Scrapes NGTeco's View Attendance Punch view, pairs the events
// into in/out per employee per day, and upserts into punches.
//
// EVERY heavy dependency below (vault, playwright scraper, importer) is
// dynamic-imported. The reason: lib/jobs/index.ts is reachable from
// instrumentation.ts via dynamic import, and adding NEW chunks under
// that subgraph confuses webpack's edge-bundle analyzer enough that it
// tries to bundle node:crypto/fs/path. Lazy-loading from inside the
// handler body keeps those modules out of the analysis path.

import { logger } from "@/lib/telemetry";
import { getSetting } from "@/lib/settings/runtime";

function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" && value !== null &&
    "ciphertext" in value && "iv" in value
  );
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

  // Dynamic imports without webpackIgnore. The previous webpackIgnored
  // relative paths broke when this handler was invoked from a server
  // action (chunk lands in /app/.next/server/chunks/N.js, so
  // ../../crypto/vault.js resolves to /app/.next/crypto/vault.js which
  // doesn't exist). Plain dynamic imports of @/ paths code-split into
  // their own chunks at build time and resolve correctly from any
  // caller — and dynamic imports aren't pulled into the edge bundle of
  // instrumentation.ts the way static imports would be.
  const vault = await import("@/lib/crypto/vault");
  const scraperMod = await import("@/lib/ngteco/scraper");
  const importerMod = await import("@/lib/punches/poll-importer");
  const { open: openSealed } = vault;
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
    const summary = await importPunchPoll(result.events, {
      timezone: company.timezone,
    });
    logger.info({ runId, ...summary }, "punch.poll: import done");
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
