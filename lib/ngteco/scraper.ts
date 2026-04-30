// Playwright-driven NGTeco scraper. Loads selectors fresh from disk each
// run (lib/ngteco/selectors.json) so the operator can edit them on the
// LXC without redeploying.
//
// All selectors are role/text/data-test based — never CSS classes (per
// spec §5.3 "Anti-fragility"). Each step has a 10–25s ceiling and writes
// a screenshot on failure for the run-detail screen.
//
// This file does NOT decrypt vaulted credentials. The caller (import.ts)
// passes plaintext as parameters, scoped to the immediate request.
//
// Node built-ins (fs, path) are loaded with createRequire-equivalent
// dynamic imports inside `scrape()` so the module is webpack-bundle-safe
// for any runtime that statically reaches it (instrumentation.ts edge
// bundle, in particular). Only Node runtime ever actually invokes scrape().

const STORAGE_ROOT = process.env.NGTECO_STORAGE_DIR ?? "/data/ngteco";

type Selectors = {
  login: { url: string; username: string; password: string; submit: string; loggedInLandmark: string };
  navigation: { reportsLink: string; punchReportLink: string };
  report: {
    fromDate: string;
    toDate: string;
    applyButton: string;
    exportCsvButton: string;
  };
  challenge: { twoFactorLandmark: string; captchaLandmark: string };
};

export type ScrapeInput = {
  portalUrl: string;
  username: string;
  password: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string;
  headless: boolean;
  /** Run id is used to bucket failure artifacts. */
  runId: string;
};

export type ScrapeOutput = {
  csv: string;
  durationMs: number;
};

export class ChallengeDetectedError extends Error {
  constructor(public kind: "TWO_FACTOR" | "CAPTCHA") {
    super(`NGTeco scraper aborted: ${kind} challenge detected`);
  }
}

export class ScrapeFailure extends Error {
  constructor(
    message: string,
    public artifacts: { screenshotPath?: string; htmlPath?: string },
  ) {
    super(message);
  }
}

async function loadSelectors(): Promise<Selectors> {
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const p = join(process.cwd(), "lib", "ngteco", "selectors.json");
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as Selectors;
}

/**
 * Run a real scrape end-to-end against the live NGTeco portal. Returns the
 * downloaded CSV blob as a string. On failure, captures screenshot + HTML
 * to /data/ngteco/failures/<runId>/ and rethrows ScrapeFailure.
 *
 * Implementation note: Playwright is dynamically imported to avoid pulling
 * the Node-only chromium runtime into Next.js's webpack server bundle. Only
 * the import job's worker actually loads this module.
 */
export async function scrape(input: ScrapeInput): Promise<ScrapeOutput> {
  const { mkdirSync, existsSync } = await import("fs");
  const { join } = await import("path");
  const PROFILE_DIR = join(STORAGE_ROOT, "profile");
  const FAILURES_DIR = join(STORAGE_ROOT, "failures");
  const sel = await loadSelectors();
  const t0 = Date.now();
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const failureDir = join(FAILURES_DIR, input.runId);

  const { chromium } = (await import("playwright")) as typeof import("playwright");
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: input.headless,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);

  const captureFailure = async (reason: string): Promise<never> => {
    if (!existsSync(failureDir)) mkdirSync(failureDir, { recursive: true });
    const screenshotPath = join(failureDir, "page.png");
    const htmlPath = join(failureDir, "page.html");
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const html = await page.content();
      const { writeFileSync } = await import("fs");
      writeFileSync(htmlPath, html);
    } catch {
      /* best-effort */
    }
    await ctx.close();
    throw new ScrapeFailure(reason, { screenshotPath, htmlPath });
  };

  try {
    await page.goto(input.portalUrl, { waitUntil: "domcontentloaded" });

    // Detect challenges before doing anything destructive.
    const twoFa = await page.locator(sel.challenge.twoFactorLandmark).count();
    if (twoFa > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("TWO_FACTOR");
    }
    const captcha = await page.locator(sel.challenge.captchaLandmark).count();
    if (captcha > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("CAPTCHA");
    }

    // If we land on a page with the username field, log in. Otherwise
    // assume the persistent profile already has a session.
    const needsLogin = (await page.locator(sel.login.username).count()) > 0;
    if (needsLogin) {
      await page.fill(sel.login.username, input.username);
      await page.fill(sel.login.password, input.password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
        page.click(sel.login.submit),
      ]);
      await page.waitForSelector(sel.login.loggedInLandmark, { timeout: 15_000 });
    }

    // Navigate to punch report.
    await page.click(sel.navigation.reportsLink);
    await page.click(sel.navigation.punchReportLink);

    // Date range.
    await page.fill(sel.report.fromDate, input.fromDate);
    await page.fill(sel.report.toDate, input.toDate);
    await page.click(sel.report.applyButton);

    // Export CSV — capture the download.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.click(sel.report.exportCsvButton),
    ]);
    const stream = await download.createReadStream();
    if (!stream) return await captureFailure("download stream was null");
    let csv = "";
    for await (const chunk of stream) csv += chunk.toString("utf8");
    await ctx.close();
    return { csv, durationMs: Date.now() - t0 };
  } catch (err) {
    if (err instanceof ChallengeDetectedError) throw err;
    return await captureFailure(
      err instanceof Error ? err.message : String(err),
    );
  }
}
