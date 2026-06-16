// Chromium lifecycle backstop.
//
// The NGTeco scraper launches a headless Chrome per poll. pg-boss can abandon
// a job (15-min expiry) without killing the browser the Node handler spawned,
// so an overrun scrape leaves an orphaned chrome-headless process. Left
// unchecked these accumulate (a real incident left 16 of them holding 1.3 GB),
// starving subsequent scrapes until the box is cleaned by hand.
//
// This module is the single place that force-kills those browsers. It is safe
// to call killAllChromium() unconditionally because the punch-poll queue is
// single-flight (teamConcurrency=1) — only one scrape's browser ever exists at
// a time. The reaper job (lib/jobs/index.ts) only calls it when no poll is
// active, so a legitimate in-flight scrape is never touched.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@/lib/telemetry";

const pexec = promisify(execFile);

/** Count live headless-chrome processes. Returns 0 if none or pgrep is absent. */
export async function countChromium(): Promise<number> {
  try {
    const { stdout } = await pexec("pgrep", ["-f", "chrome-headless"]);
    const lines = stdout.trim();
    return lines ? lines.split("\n").length : 0;
  } catch {
    // pgrep exits 1 when nothing matches — that's "zero", not an error.
    return 0;
  }
}

/**
 * Force-kill every headless Chrome the scraper may have spawned. Returns the
 * number of processes that were alive before the kill (0 if none).
 *
 * Called on the poll hard-timeout, on an explicit admin cancel, and by the
 * reaper job. Best-effort: a missing pkill or a race just yields 0.
 */
export async function killAllChromium(): Promise<number> {
  try {
    const before = await countChromium();
    if (before === 0) return 0;
    await pexec("pkill", ["-9", "-f", "chrome-headless"]).catch(() => undefined);
    logger.warn({ killed: before }, "chromium-reaper: force-killed headless chrome");
    return before;
  } catch (err) {
    logger.error({ err }, "chromium-reaper: killAllChromium failed");
    return 0;
  }
}
