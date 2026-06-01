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
import {
  filterAlertsForPollSync,
  syncMissedPunchAlerts,
} from "@/lib/payroll/sync-missed-punch-alerts";

function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" && value !== null &&
    "ciphertext" in value && "iv" in value
  );
}

/**
 * ISO timestamp for 00:00 (midnight) of TODAY (or N days ago) in `tz`.
 * Used as the lower bound when filtering scraped NGTeco events.
 *
 * Default behaviour (daysBack=0): each poll only ingests today's
 * punches. Yesterday's data is locked in by the time we hit a new
 * calendar day. Owner directive when the system is healthy.
 *
 * Backfill behaviour (daysBack>0): the operator triggered a recovery
 * because the cron didn't run for some interval. We slide the lower
 * bound back N days so previously-missed punches make it in. Existing
 * rows are deduped by ngteco_record_hash inside the importer, so
 * re-scraping today is safe.
 *
 * Returned in the form scraper events use ("YYYY-MM-DDTHH:mm:ss" with
 * the tz offset truncated). String compare against punchAt which has
 * the form "YYYY-MM-DDTHH:mm:ss-04:00" — works because the date
 * portion is identical-prefix when dates match.
 */
function startOfDayIso(tz: string, daysBack: number): string {
  // Get today's calendar date in `tz`, then subtract daysBack days.
  // Doing this on the date string (not the Date object) avoids DST
  // edge cases — we want calendar-day arithmetic, not 24h-clock.
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
    new Date(),
  );
  if (daysBack <= 0) return `${todayStr}T00:00:00`;
  const [y, m, d] = todayStr.split("-").map(Number);
  // Date.UTC gives us a stable point we can subtract days from. The
  // calendar date we want is in `tz`, so we treat the UTC representation
  // of that date as our anchor and step back N times. The output is the
  // resulting calendar-date string regardless of `tz`'s DST shifts.
  const ms = Date.UTC(y!, m! - 1, d!) - daysBack * 86_400_000;
  const back = new Date(ms);
  const backStr = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-${String(back.getUTCDate()).padStart(2, "0")}`;
  return `${backStr}T00:00:00`;
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
  /** Number of calendar days the poll covered (1 = today only,
   *  2 = today + yesterday, etc.). Lets the UI show "Backfilled
   *  3 days, 12 new pairs" instead of just a count. */
  daysCovered?: number;
  /** When the cron auto-widens its window because the last
   *  successful poll was hours/days ago, this carries the human
   *  reason ("last successful poll 18.4h ago — auto-widening to
   *  1 day") so the UI / logs can show what happened. */
  autoBackfillReason?: string;
};

/**
 * Options for running a poll. The cron + the "Poll punches now" button
 * call with no options — that's the today-only fast path. The
 * backfill action passes `daysBack` so the operator can recover punches
 * from days when the cron didn't run (login bug, NGTeco outage, server
 * downtime). NGTeco's View Attendance Punch keeps the most recent
 * window; for daysBack > ~5 the importer relies on the maxRows bump
 * to scroll the virtual grid back far enough.
 */
export type PollOptions = {
  /** How many calendar days back to ingest, in the company timezone.
   *  0 (default) = today only. 1 = today + yesterday. 7 = last 7 days. */
  daysBack?: number;
};

export async function handlePunchPoll(
  opts: PollOptions = {},
): Promise<PollSummary> {
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

  // Backfill bumps maxRows so the virtual-scrolling MuiDataGrid is
  // walked back far enough to cover the requested window. Default
  // 1000 is fine for ~5 days at typical 50-employee, 4-punch/day
  // density; multiply by daysBack with a floor of 1000 to keep
  // today-only polls fast.
  let daysBack = Math.max(0, Math.floor(opts.daysBack ?? 0));

  // AUTO-RECOVERY. The whole point of this system is "owner runs
  // payroll in <5 min/week" — so the cron has to self-heal when it's
  // been broken for a stretch. Look at the last *successful* poll;
  // if that's more than a few hours stale, widen our window to span
  // the gap so missed days fill in without any human action. The
  // open-punch fallback in poll-importer.ts then closes any IN-only
  // shifts the prior, broken polls left behind. Capped at 14 days
  // to match the manual button's contract and to bound how far the
  // virtual grid is asked to scroll.
  //
  // Skipped when the caller already specified daysBack > 0 (the
  // operator-triggered "Backfill missing days" button) — their
  // explicit window wins.
  let autoBackfillReason: string | null = null;
  if (daysBack === 0) {
    try {
      const { getLastSuccessfulPoll } = await import(
        "@/lib/db/queries/poll-history"
      );
      const last = await getLastSuccessfulPoll();
      const hoursStale = last
        ? (Date.now() - new Date(last.startedAt).getTime()) / 3_600_000
        : Infinity;
      // 4h is the threshold — anything tighter and a routine outage
      // (cron worker restart, brief NGTeco hiccup) would unnecessarily
      // widen the window. 4h reliably means "we missed at least one
      // 15-min cron tick AND a few retries."
      //
      // Cap at 30 days: covers the "owner is in a car wreck and out
      // for a month" scenario that motivates this whole self-healing
      // path. NGTeco's View Attendance Punch view typically holds a
      // rolling 30-90 day window; the scraper's page cap was raised
      // to 200 in lockstep so we can actually walk that far back.
      // Beyond 30 days the legacy CSV-export "Run NGTeco import now"
      // flow is the right tool — it scopes by period dates.
      if (hoursStale >= 4) {
        const gapDays = Math.min(
          30,
          Math.max(1, Math.ceil(hoursStale / 24)),
        );
        daysBack = gapDays;
        autoBackfillReason = last
          ? `last successful poll ${hoursStale.toFixed(1)}h ago — auto-widening to ${gapDays} day${gapDays === 1 ? "" : "s"}`
          : `no successful poll on record — auto-widening to ${gapDays} days`;
        logger.info(
          {
            hoursStale: Number(hoursStale.toFixed(2)),
            gapDays,
            lastSuccessfulAt: last?.startedAt ?? null,
          },
          "punch.poll: auto-backfill triggered",
        );
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "punch.poll: auto-backfill probe failed (continuing today-only)",
      );
    }
  }
  const maxRows = daysBack > 0 ? Math.max(1000, daysBack * 400) : undefined;

  try {
    const result = await scrapeViewAttendance({
      portalUrl: ngteco.portalUrl,
      username,
      password,
      headless: ngteco.headless,
      runId,
      ...(maxRows !== undefined ? { maxRows } : {}),
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
        daysCovered: daysBack + 1,
        ...(autoBackfillReason ? { autoBackfillReason } : {}),
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
    const windowStartIso = startOfDayIso(company.timezone, daysBack);
    const filtered = result.events.filter(
      (e) => e.punchAt >= windowStartIso,
    );
    logger.info(
      {
        runId,
        scraped: result.events.length,
        kept: filtered.length,
        windowStartIso,
        daysBack,
      },
      daysBack > 0
        ? "punch.poll: backfill — window-filtered to N days"
        : "punch.poll: window-filtered to today",
    );
    const summary = await importPunchPoll(filtered, {
      timezone: company.timezone,
    });
    logger.info({ runId, ...summary }, "punch.poll: import done");

    const localHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: company.timezone,
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    );
    const shouldSyncMissedPunches =
      localHour >= 19 ||
      summary.missingClockIn > 0 ||
      summary.openShifts > 0 ||
      summary.pairsInserted > 0 ||
      summary.pairsUpdated > 0;
    if (shouldSyncMissedPunches) {
      try {
        const daySet = new Set(summary.daysTouched);
        if (localHour >= 19) {
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: company.timezone,
          }).format(new Date());
          daySet.add(today);
        }
        await syncMissedPunchAlerts({
          limitToDates: daySet.size > 0 ? daySet : undefined,
          filterAlerts: (alerts) =>
            filterAlertsForPollSync(alerts, company.timezone, new Date()),
        });
      } catch (err) {
        logger.warn(
          { runId, err: err instanceof Error ? err.message : String(err) },
          "punch.poll: missed-punch sync failed (non-fatal)",
        );
      }
    }

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
      daysCovered: daysBack + 1,
      ...(autoBackfillReason ? { autoBackfillReason } : {}),
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
