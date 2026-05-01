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
  navigation: {
    reportsLink: string;
    punchReportLink: string;
    attendanceMenu?: string;
    viewAttendancePunchLink?: string;
  };
  report: {
    fromDate: string;
    toDate: string;
    applyButton: string;
    exportCsvButton: string;
  };
  viewPunch?: {
    tableLandmark: string;
    rowsContainer: string;
    personNameCell: string;
    personIdCell: string;
    punchDateCell: string;
    punchTimeCell: string;
    verifyTypeCell: string;
    timezoneCell: string;
    sourceCell: string;
    nextPageButton: string;
    pageInfo: string;
  };
  challenge: { twoFactorLandmark: string; captchaLandmark: string };
};

export type RawPunchEvent = {
  /** NGTeco "Person ID" — typically a numeric string, sometimes leading-zero. */
  personId: string;
  /** Display name from the Person Name column. */
  personName: string;
  /** Wall-clock punch instant in the device's timezone, ISO with offset. */
  punchAt: string;
  /** "Fingerprint" / "Face" / "Manual" / etc. */
  verifyType: string;
  /** Device serial (e.g. NMR2241400323) from the Source column. */
  source: string;
};

export type PollScrapeInput = {
  portalUrl: string;
  username: string;
  password: string;
  headless: boolean;
  /** Used to bucket failure artifacts; usually a poll-tick id. */
  runId: string;
  /** Hard cap on rows. Default 1000. */
  maxRows?: number;
};

export type PollScrapeOutput = {
  events: RawPunchEvent[];
  durationMs: number;
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
  const { readFileSync } = await import(/* webpackIgnore: true */ "node:fs");
  const { join } = await import(/* webpackIgnore: true */ "node:path");
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
  const { mkdirSync, existsSync } = await import(/* webpackIgnore: true */ "node:fs");
  const { join } = await import(/* webpackIgnore: true */ "node:path");
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
      const { writeFileSync } = await import(/* webpackIgnore: true */ "node:fs");
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

/**
 * Real-time per-punch scrape against the View Attendance Punch view. Runs
 * on a short interval (5–15 min) and pulls the most recent punches the
 * device has uploaded. Returns raw events; the importer pairs them into
 * in/out per employee per day.
 *
 * Defaults to "no date filter" — the view itself shows the most recent
 * page (today's punches first). For backfill scenarios the caller can
 * raise maxRows; the loop pages forward until either maxRows hits or no
 * Next button appears.
 */
export async function scrapeViewAttendance(
  input: PollScrapeInput,
): Promise<PollScrapeOutput> {
  const { mkdirSync, existsSync } = await import(/* webpackIgnore: true */ "node:fs");
  const { join } = await import(/* webpackIgnore: true */ "node:path");
  const PROFILE_DIR = join(STORAGE_ROOT, "profile");
  const FAILURES_DIR = join(STORAGE_ROOT, "failures");
  const sel = await loadSelectors();
  if (!sel.viewPunch) {
    throw new ScrapeFailure("selectors.viewPunch not configured", {});
  }
  if (!sel.navigation.viewAttendancePunchLink) {
    throw new ScrapeFailure(
      "selectors.navigation.viewAttendancePunchLink not configured",
      {},
    );
  }
  const t0 = Date.now();
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const failureDir = join(FAILURES_DIR, input.runId);
  const maxRows = input.maxRows ?? 1000;

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
      const { writeFileSync } = await import(/* webpackIgnore: true */ "node:fs");
      writeFileSync(htmlPath, html);
    } catch {
      /* best-effort */
    }
    await ctx.close();
    throw new ScrapeFailure(reason, { screenshotPath, htmlPath });
  };

  try {
    await page.goto(input.portalUrl, { waitUntil: "domcontentloaded" });

    // Challenge gates first.
    if ((await page.locator(sel.challenge.twoFactorLandmark).count()) > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("TWO_FACTOR");
    }
    if ((await page.locator(sel.challenge.captchaLandmark).count()) > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("CAPTCHA");
    }

    // Login if needed.
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

    // Expand Attendance menu if collapsed, then click View Attendance Punch.
    if (sel.navigation.attendanceMenu) {
      try {
        await page.click(sel.navigation.attendanceMenu, { timeout: 5_000 });
      } catch {
        // Menu may already be expanded; ignore.
      }
    }
    await page.click(sel.navigation.viewAttendancePunchLink);
    await page.waitForSelector(sel.viewPunch.tableLandmark, { timeout: 15_000 });

    const events: RawPunchEvent[] = [];
    const seenKeys = new Set<string>();
    let pages = 0;
    while (events.length < maxRows && pages < 50) {
      pages++;
      // Snapshot the table.
      const rows = page.locator(sel.viewPunch.rowsContainer);
      const rowCount = await rows.count();
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const cells = await Promise.all([
          row.locator(sel.viewPunch.personNameCell).first().textContent(),
          row.locator(sel.viewPunch.personIdCell).first().textContent(),
          row.locator(sel.viewPunch.punchDateCell).first().textContent(),
          row.locator(sel.viewPunch.punchTimeCell).first().textContent(),
          row.locator(sel.viewPunch.verifyTypeCell).first().textContent(),
          row.locator(sel.viewPunch.timezoneCell).first().textContent(),
          row.locator(sel.viewPunch.sourceCell).first().textContent(),
        ]);
        const personName = (cells[0] ?? "").trim();
        const personId = (cells[1] ?? "").trim();
        const dateRaw = (cells[2] ?? "").trim();
        const timeRaw = (cells[3] ?? "").trim();
        const verifyType = (cells[4] ?? "").trim();
        const tzRaw = (cells[5] ?? "").trim();
        const source = (cells[6] ?? "").trim();
        if (!personId || !dateRaw || !timeRaw) continue;
        const punchAt = composeIso(dateRaw, timeRaw, tzRaw);
        if (!punchAt) continue;
        const key = `${personId}|${punchAt}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        events.push({ personId, personName, punchAt, verifyType, source });
      }
      // Try to advance.
      const next = page.locator(sel.viewPunch.nextPageButton).first();
      const visible = (await next.count()) > 0 && (await next.isEnabled().catch(() => false));
      if (!visible) break;
      await Promise.all([
        page.waitForTimeout(400), // small debounce for the pagination redraw
        next.click().catch(() => {}),
      ]);
    }

    await ctx.close();
    return { events, durationMs: Date.now() - t0 };
  } catch (err) {
    if (err instanceof ChallengeDetectedError) throw err;
    return await captureFailure(
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Compose an ISO timestamp from NGTeco's display strings. Date is
 * MM/DD/YYYY or YYYY-MM-DD; time is HH:MM:SS; tz is `±HH:MM`.
 */
function composeIso(
  dateRaw: string,
  timeRaw: string,
  tzRaw: string,
): string | null {
  let dateIso: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    dateIso = dateRaw;
  } else {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(dateRaw);
    if (!us) return null;
    const m = us[1]!.padStart(2, "0");
    const d = us[2]!.padStart(2, "0");
    let y = us[3]!;
    if (y.length === 2) {
      const candidate = 2000 + Number(y);
      const candidateMs = new Date(`${candidate}-${m}-${d}T12:00:00Z`).getTime();
      const sixMonths = Date.now() + 6 * 30 * 24 * 60 * 60 * 1000;
      y = String(candidateMs > sixMonths ? candidate - 100 : candidate);
    }
    dateIso = `${y}-${m}-${d}`;
  }
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeRaw);
  if (!tm) return null;
  const hh = tm[1]!.padStart(2, "0");
  const mm = tm[2]!;
  const ss = (tm[3] ?? "00").padStart(2, "0");
  // Default tz to America/New_York EDT (-04:00) when the page strips it.
  const tz = /^[+-]\d{2}:\d{2}$/.test(tzRaw) ? tzRaw : "-04:00";
  return `${dateIso}T${hh}:${mm}:${ss}${tz}`;
}
