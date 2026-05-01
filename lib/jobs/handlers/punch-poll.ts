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

export async function handlePunchPoll(): Promise<void> {
  const ngteco = await getSetting("ngteco").catch(() => null);
  const company = await getSetting("company").catch(() => null);
  if (!ngteco || !company) {
    logger.info("punch.poll: settings unavailable; skipping");
    return;
  }
  if (
    !isEnvelope(ngteco.usernameEncrypted) ||
    !isEnvelope(ngteco.passwordEncrypted)
  ) {
    logger.info("punch.poll: NGTeco credentials not configured; skipping");
    return;
  }
  const runId = `poll-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  // webpackIgnore: tells webpack NOT to follow these chunks — the modules
  // are resolved at runtime by Node, which is the only runtime that calls
  // this handler. Without the ignore, webpack walks vault → node:crypto +
  // scraper → fs/path on edge bundles and the build fails. Same trick as
  // ngteco-import.ts.
  const vault = (await import(
    /* webpackIgnore: true */ "../../crypto/vault.js"
  )) as typeof import("@/lib/crypto/vault");
  const scraperMod = (await import(
    /* webpackIgnore: true */ "../../ngteco/scraper.js"
  )) as typeof import("@/lib/ngteco/scraper");
  const importerMod = (await import(
    /* webpackIgnore: true */ "../../punches/poll-importer.js"
  )) as typeof import("@/lib/punches/poll-importer");
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
    if (result.events.length === 0) return;
    const summary = await importPunchPoll(result.events, {
      timezone: company.timezone,
    });
    logger.info({ runId, ...summary }, "punch.poll: import done");
  } catch (err) {
    if (err instanceof ChallengeDetectedError) {
      logger.warn({ runId, kind: err.kind }, "punch.poll: challenge detected");
      return;
    }
    if (err instanceof ScrapeFailure) {
      logger.error(
        { runId, msg: err.message, screenshot: err.artifacts.screenshotPath },
        "punch.poll: scrape failure",
      );
      return;
    }
    logger.error(
      { runId, err: err instanceof Error ? err.message : String(err) },
      "punch.poll: unexpected error",
    );
  }
}
