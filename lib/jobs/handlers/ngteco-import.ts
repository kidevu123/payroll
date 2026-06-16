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
  // Dynamic-import via the "@/" alias — same pattern punch-poll.ts uses and
  // the only one that actually resolves in the standalone build. The previous
  // `webpackIgnore` + relative "../../ngteco/import.js" resolved at runtime to
  // /app/.next/ngteco/import.js, which does not exist in the standalone
  // output, so every "Run NGTeco import now" failed with ERR_MODULE_NOT_FOUND.
  // These imports are still dynamic, so the Playwright + node:fs chain stays
  // out of the edge bundle for instrumentation.ts.
  const importModule = await import("@/lib/ngteco/import");
  const scraperModule = await import("@/lib/ngteco/scraper");
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
