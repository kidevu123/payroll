// pg-boss handler for ngteco.import. Wraps lib/ngteco/import.ts with:
//   • exponential backoff retries (max 3)
//   • failure capture (the scraper does the screenshot + HTML; we
//     persist the paths on payroll_runs)
//   • OTel-style spans via the structured logger (real OTel spans land
//     when the SDK gets exporter wiring beyond console)
//
// All imports of lib/ngteco/* are dynamic so the chain (Playwright + node:fs
// callers) is not statically reachable from instrumentation.ts. Webpack
// then never tries to bundle them for the edge runtime.

import { logger } from "@/lib/telemetry";
import { markIngestFailed } from "@/lib/db/queries/payroll-runs";
import { getBoss } from "@/lib/jobs";

export async function handleNgtecoImport(
  data: { runId: string },
): Promise<void> {
  const { runId } = data;
  // webpackIgnore: tells webpack NOT to bundle these chunks — the modules are
  // resolved at runtime by Node, which is the only runtime that ever calls
  // this handler. Without the ignore, webpack walks Playwright + fs/path on
  // edge bundles and the build fails.
  const importModule = (await import(
    /* webpackIgnore: true */ "../../ngteco/import.js"
  )) as typeof import("@/lib/ngteco/import");
  const scraperModule = (await import(
    /* webpackIgnore: true */ "../../ngteco/scraper.js"
  )) as typeof import("@/lib/ngteco/scraper");
  const { runImport } = importModule;
  const { ScrapeFailure, ChallengeDetectedError } = scraperModule;
  try {
    const summary = await runImport(runId);
    logger.info({ runId, ...summary }, "ngteco.import: handler ok");
    // Chain into detection. The detect handler decides employee-fix vs
    // admin-review next states and dispatches notifications.
    const boss = await getBoss();
    await boss.send("payroll.run.detect-exceptions", { runId });
  } catch (err) {
    if (err instanceof ChallengeDetectedError) {
      logger.error({ runId, kind: err.kind }, "ngteco.import: challenge — abort, no retry");
      await markIngestFailed(
        runId,
        `challenge: ${err.kind} — disable 2FA / clear captcha and re-run`,
      );
      return;
    }
    if (err instanceof ScrapeFailure) {
      logger.error(
        { runId, screenshot: err.artifacts.screenshotPath },
        `ngteco.import: scrape failure — ${err.message}`,
      );
      await markIngestFailed(runId, err.message, {
        ...(err.artifacts.screenshotPath
          ? { screenshotPath: err.artifacts.screenshotPath }
          : {}),
        ...(err.artifacts.htmlPath ? { logPath: err.artifacts.htmlPath } : {}),
      });
      throw err;
    }
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ runId, err }, `ngteco.import: ${reason}`);
    await markIngestFailed(runId, reason);
    throw err;
  }
}
