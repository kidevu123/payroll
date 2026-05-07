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
  login: {
    url: string;
    username: string;
    password: string;
    /** Optional — NGTeco gates Login behind a "I have read the agreement"
     *  checkbox. Tick it before submit when present. */
    agreementCheckbox?: string;
    /** The clickable wrapper for the agreement checkbox (Element Plus
     *  hides the real <input> and routes clicks through .el-checkbox__inner).
     *  Falls back to the input itself when missing. */
    agreementClickTarget?: string;
    submit: string;
    loggedInLandmark: string;
  };
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

/** True if any path segment is exactly "login". Catches /user/login,
 *  /login, /admin/login/, etc., but not /login-help or /relogin. */
function isLoginPath(pathname: string): boolean {
  return pathname.split("/").filter(Boolean).some((seg) => seg.toLowerCase() === "login");
}

/** Are we on the login page? URL is checked first (most reliable);
 *  DOM probes (label/input/password field) are a fallback for portals
 *  whose login route doesn't include "login" in the path. */
async function detectLoginPage(
  page: import("playwright-core").Page,
  sel: Selectors,
): Promise<boolean> {
  // URL is the most reliable signal. NGTeco's SPA mounts on
  // domcontentloaded but MUI's password input is added a beat later,
  // and the original DOM-only check raced that hydration: we'd land on
  // /user/login, see no password field yet, decide we were "logged in",
  // skip the login flow, and 30s later fail navigation with a sidebar
  // that read like the login page (because it WAS the login page).
  // The pathname always reflects /login the moment NGTeco redirects,
  // so check it first.
  try {
    const path = new URL(page.url()).pathname;
    if (isLoginPath(path)) return true;
  } catch {
    /* page.url() is invalid? proceed with DOM checks */
  }
  if (sel.login.username && (await page.locator(sel.login.username).count()) > 0) {
    return true;
  }
  // MUI labels — the live portal uses these.
  if ((await page.getByLabel(/email/i).count()) > 0) return true;
  if ((await page.locator('input[type="password"]').count()) > 0) return true;
  return false;
}

/** Hard assertion: throws if the page is currently on /login. Use at
 *  boundary points where being on /login means a session bounce
 *  (cookies expired) or a credential rejection — failing loudly is
 *  better than letting downstream selectors time out 30s later with
 *  no clue why. */
function assertNotOnLoginPage(
  page: import("playwright-core").Page,
  context: string,
): void {
  let path = "";
  try {
    path = new URL(page.url()).pathname;
  } catch {
    return;
  }
  if (isLoginPath(path)) {
    throw new ScrapeFailure(
      `NGTeco session bounce at ${context}: page is on ${page.url()}. The persistent browser session has expired and the saved credentials no longer let us in. Clear /data/ngteco/profile inside the LXC (rm -rf) so the next poll logs in fresh; if that still fails, the credentials in Settings → NGTeco are out of date.`,
      {},
    );
  }
}

/** Fill a login field using the most reliable strategy first.
 *  Strategy order, derived from the live office.ngteco.com DOM:
 *    1. input[name="username"] / input[name="password"] — MUI's
 *       form names are stable across visual themes. ✔ confirmed
 *       working against the live portal.
 *    2. getByPlaceholder — "Email" / "Password" placeholders are
 *       human-readable and survive class refactors.
 *    3. semantic input attribute (input[type="password"], etc.).
 *    4. configured CSS selector (legacy / operator override).
 *
 *  CRITICAL: every strategy is filtered to VISIBLE inputs only. The
 *  bug that motivated this comment: NGTeco's MUI form has hidden
 *  helper inputs (autocomplete shadow inputs, form-state mirrors)
 *  that share name="username" / name="password" with the visible
 *  field. fill() against `.first()` writes to the hidden one, the
 *  inputValue() readback returns our value (it really did go in),
 *  the helper happily returns success — but MUI's validation then
 *  flags the visible field as required=empty and submit is rejected.
 *  Symptom: form helper-text "This field is required!" while the
 *  scraper insists it filled both fields.
 *
 *  After every fill we additionally do a "post-fill audit" — read
 *  back the value of every same-name input on the page and confirm
 *  at least one VISIBLE one carries our value. If the audit fails,
 *  we treat the strategy as failed and try the next.
 *
 *  Note: getByLabel() does not work here because the live form sets
 *  aria-label="description" on both inputs (stale MUI default), so a
 *  name-based label match never resolves. */
async function fillLoginField(
  page: import("playwright-core").Page,
  kind: "username" | "password",
  configuredSelector: string | undefined,
  value: string,
): Promise<void> {
  const placeholder = kind === "username" ? "Email" : "Password";
  const nameSelector =
    kind === "username" ? 'input[name="username"]' : 'input[name="password"]';
  const semanticSelector =
    kind === "username"
      ? 'input[type="email"], input[name*="email" i], input[name*="account" i], input[name*="user" i]'
      : 'input[type="password"]';

  /** Verify a *visible* input matching `auditSelector` actually
   *  carries the value we just wrote. Catches the "filled the hidden
   *  shadow input" failure mode. */
  const auditFill = async (auditSelector: string): Promise<boolean> => {
    try {
      const visibleVal = await page.evaluate(
        ({ sel, expected }: { sel: string; expected: string }) => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(sel));
          for (const inp of inputs) {
            // jQuery-style :visible heuristic — MUI inputs have non-zero
            // box and are not display:none / visibility:hidden / opacity:0.
            const box = inp.getBoundingClientRect();
            const cs = getComputedStyle(inp);
            const visible =
              box.width > 0 &&
              box.height > 0 &&
              cs.visibility !== "hidden" &&
              cs.display !== "none" &&
              cs.opacity !== "0";
            if (visible && inp.value === expected) return true;
          }
          return false;
        },
        { sel: auditSelector, expected: value },
      );
      return visibleVal;
    } catch {
      return false;
    }
  };

  const tryFill = async (
    loc: import("playwright-core").Locator,
    auditSelector: string,
  ): Promise<boolean> => {
    if (!(await loc.count())) return false;
    try {
      await loc.fill("");
      await loc.fill(value, { timeout: 5_000 });
      // The classic check: did fill() set inputValue on the locator
      // we acted on? Cheap and catches typos.
      const filled = await loc.inputValue();
      if (filled !== value) return false;
      // The IMPORTANT check: is at least one visible input on the
      // page carrying our value? If only the hidden shadow input has
      // it, this returns false and we fall through to the next
      // strategy.
      if (!(await auditFill(auditSelector))) return false;
      return true;
    } catch {
      return false;
    }
  };

  // Visibility-filtered locators. Playwright's :visible engine pseudo
  // matches "any element with non-zero size, not hidden by CSS, not
  // covered" — exactly what we need to skip the shadow inputs that
  // share name="username".
  const visibleNameLoc = page.locator(`${nameSelector}:visible`);
  const visibleSemanticLoc = page.locator(`${semanticSelector}:visible`);

  const auditAny =
    kind === "username"
      ? `input[name="username"], input[type="email"], input[name*="email" i], input[name*="user" i]`
      : `input[name="password"], input[type="password"]`;

  // Strategy 1: visible input by name
  if (await tryFill(visibleNameLoc.first(), auditAny)) return;

  // Strategy 2: getByRole textbox with accessible name (placeholder
  // is part of accessible name in MUI). Naturally targets the
  // visible control because the role tree omits hidden helpers.
  const roleNameRe = kind === "username" ? /email|account|user/i : /password/i;
  if (
    await tryFill(
      page.getByRole("textbox", { name: roleNameRe }).first(),
      auditAny,
    )
  )
    return;

  // Strategy 3: getByPlaceholder("Email" / "Password") — placeholder
  // text is render-attached to the visible input, not the shadow one.
  if (
    await tryFill(
      page.getByPlaceholder(placeholder, { exact: true }).first(),
      auditAny,
    )
  )
    return;

  // Strategy 4: semantic attribute, visibility-filtered
  if (await tryFill(visibleSemanticLoc.first(), auditAny)) return;

  // Strategy 5: configured selector (legacy / operator override).
  // Still audit-checked — if a stale operator override targets a
  // hidden input, we want to know so we can fall through to the
  // diagnostic dump rather than submit a half-filled form.
  if (configuredSelector) {
    try {
      await page.fill(configuredSelector, value, { timeout: 5_000 });
      if (await auditFill(auditAny)) return;
    } catch {
      /* fall through to diagnostic */
    }
  }

  // Final: dump enough structure to debug *what* inputs are on the
  // page. Without this, the same failure recurs every poll with no
  // progressing diagnostics.
  let inventory = "(unable to read)";
  try {
    inventory = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      return inputs
        .slice(0, 20)
        .map((i) => {
          const box = i.getBoundingClientRect();
          const cs = getComputedStyle(i);
          const visible =
            box.width > 0 &&
            box.height > 0 &&
            cs.visibility !== "hidden" &&
            cs.display !== "none" &&
            cs.opacity !== "0";
          return `${visible ? "•" : "·"}{name=${i.name || "-"}, type=${i.type}, placeholder=${i.placeholder || "-"}, ariaLabel=${i.getAttribute("aria-label") ?? "-"}}`;
        })
        .join(" ");
    });
  } catch {
    /* keep placeholder */
  }
  throw new ScrapeFailure(
    `Could not locate a visible ${kind} field that accepts our value. Inputs on page (• = visible, · = hidden): ${inventory}. NGTeco probably renamed the field; update lib/ngteco/scraper.ts fillLoginField with the new attributes shown above.`,
    {},
  );
}

/** Tick the "I have read and agree to the User Agreement & Privacy
 *  Policy" checkbox if it exists on the page. NGTeco's MUI login
 *  form disables the Login button until this is checked, and the
 *  poll has been silently failing because the script never ticked
 *  it. We locate it by the surrounding text rather than DOM
 *  position so a future re-order doesn't break us. */
async function ensureAgreementChecked(
  page: import("playwright-core").Page,
): Promise<void> {
  // First try the labelled control (MUI wraps the checkbox + the
  // text in a single FormControlLabel, so getByLabel can resolve
  // it once we strip the trailing "User Agreement & Privacy
  // Policy" buttons that sit right after).
  const candidates: import("playwright-core").Locator[] = [
    page.getByLabel(/i have read and agree/i),
    // Fallback: the FormControlLabel root contains the text — find it
    // and then the checkbox inside.
    page
      .locator('label')
      .filter({ hasText: /i have read and agree/i })
      .locator('input[type="checkbox"]'),
    // Last-ditch: of the two checkboxes in the login form, the
    // agreement one is the FIRST (Remember-Me is second).
    page.locator('input[type="checkbox"]').first(),
  ];
  for (const cb of candidates) {
    try {
      if (!(await cb.count())) continue;
      const checked = await cb.first().isChecked().catch(() => false);
      if (checked) return;
      await cb.first().check({ timeout: 4_000, force: true });
      const nowChecked = await cb.first().isChecked().catch(() => false);
      if (nowChecked) return;
    } catch {
      /* try the next candidate */
    }
  }
  // Don't throw — some NGTeco tenants don't show the checkbox at
  // all. The post-submit /login redirect check will catch the real
  // failure if the button stays disabled.
}

/** Click the login submit button. Tries the configured selector,
 *  then falls back to a button labelled "Login". */
async function clickLoginSubmit(
  page: import("playwright-core").Page,
  configuredSelector: string | undefined,
): Promise<void> {
  if (configuredSelector) {
    try {
      await page.click(configuredSelector, { timeout: 5_000 });
      return;
    } catch {
      /* fall through */
    }
  }
  await page
    .getByRole("button", { name: /^log\s*in$|^sign\s*in$/i })
    .first()
    .click({ timeout: 6_000 });
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
  // Force headless on server-side Playwright. The settings toggle was a
  // dev convenience that has no equivalent on the LXC (no X server, no
  // $DISPLAY) — surfaces as "Missing X server or $DISPLAY" otherwise.
  // input.headless stays in the type for backward-compat with callers.
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
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
      // NGTeco gates the Login button behind "I have read and agree to
      // the user agreement & privacy policy". Element Plus checkboxes
      // hide the real <input> and route events through .el-checkbox__inner;
      // .check() on the input is a no-op. Click the wrapper instead. The
      // selector targets the wrapper that contains the "have read" text
      // specifically — there's a second "Remember account" checkbox on
      // the page that we must NOT toggle.
      const clickTarget =
        sel.login.agreementClickTarget ?? sel.login.agreementCheckbox;
      if (clickTarget) {
        try {
          // Verify it's not already checked, then click. Use the input
          // selector to read state, the clickTarget to actually click.
          const cb = sel.login.agreementCheckbox
            ? page.locator(sel.login.agreementCheckbox).first()
            : null;
          const alreadyChecked = cb
            ? await cb.isChecked().catch(() => false)
            : false;
          if (!alreadyChecked) {
            await page
              .locator(clickTarget)
              .first()
              .click({ timeout: 5_000 });
          }
        } catch {
          /* no checkbox visible / already accepted */
        }
      }
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
  // viewAttendancePunchLink is no longer hard-required — the click path
  // falls back through getByRole + getByText if it's missing or stale.
  const t0 = Date.now();
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const failureDir = join(FAILURES_DIR, input.runId);
  const maxRows = input.maxRows ?? 1000;

  const { chromium } = (await import("playwright")) as typeof import("playwright");
  // Force headless on server-side Playwright. The settings toggle was a
  // dev convenience that has no equivalent on the LXC (no X server, no
  // $DISPLAY) — surfaces as "Missing X server or $DISPLAY" otherwise.
  // input.headless stays in the type for backward-compat with callers.
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
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

    // Wait for the SPA to actually mount before we look at the DOM.
    // domcontentloaded fires before MUI hydrates, and the post-redirect
    // /user/login page has an empty body for a beat — without this
    // wait, detectLoginPage can race the hydration and decide we're
    // already inside the dashboard. networkidle is too aggressive on
    // MUI (their telemetry pings keep the connection busy), so we wait
    // for body to actually have content as a proxy for "first paint
    // happened".
    try {
      await page.waitForFunction(
        () => (document.body?.textContent ?? "").trim().length > 50,
        null,
        { timeout: 8_000 },
      );
    } catch {
      /* proceed; downstream selector probes will catch a still-blank page */
    }

    // Challenge gates first.
    if ((await page.locator(sel.challenge.twoFactorLandmark).count()) > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("TWO_FACTOR");
    }
    if ((await page.locator(sel.challenge.captchaLandmark).count()) > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("CAPTCHA");
    }

    // Login if needed. NGTeco rebuilt their login form on MUI; the
    // configured CSS selector (Element Plus era) silently mis-targets,
    // and fill() ends up writing to a hidden input while the visible
    // Email field stays empty. Failure mode: form submits, MUI shows
    // "This field is required!" on Email, and the SPA stays on /login.
    //
    // Fix: prefer label/role-based locators (those survive a CSS
    // refactor) and fall through to the configured selector last.
    // After submit, *verify* we left /login; if not, throw a clear
    // error instead of timing out 30s downstream looking for menu
    // links that will never appear.
    const onLoginPage = await detectLoginPage(page, sel);
    if (onLoginPage) {
      await fillLoginField(page, "username", sel.login.username, input.username);
      await fillLoginField(page, "password", sel.login.password, input.password);
      // Tick the User Agreement / Privacy Policy checkbox — NGTeco's
      // MUI login disables the submit button until it's checked, so
      // skipping this step silently kept the form on /login.
      await ensureAgreementChecked(page);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
        clickLoginSubmit(page, sel.login.submit),
      ]);
      // Hard verification: did we actually get off /login? MUI's
      // client-side validation can reject a partially-filled form
      // and keep the SPA on the login route — that needs to fail
      // loudly here, not 30s later when a menu click times out.
      try {
        // Inlined segment check — same logic as isLoginPath, but
        // page.waitForFunction runs in the browser so no Node import.
        // /login-help wouldn't false-trigger; only an exact "login"
        // segment counts.
        await page.waitForFunction(
          () =>
            !window.location.pathname
              .split("/")
              .filter(Boolean)
              .map((s) => s.toLowerCase())
              .includes("login"),
          null,
          { timeout: 10_000 },
        );
      } catch {
        const url = page.url();
        // Read any visible MUI form helper-text error so we can tell
        // the operator *why* login failed (wrong password vs locked
        // account vs captcha) instead of a generic "did not complete".
        let helper = "";
        // Also dump what's actually IN the visible inputs at submit
        // time. "This field is required!" with our scraper insisting
        // it filled both fields means fill landed in a hidden helper
        // input — the inventory tells us which field was actually empty.
        let fieldDump = "";
        try {
          const diag = await page.evaluate(() => {
            const errs = Array.from(
              document.querySelectorAll(
                ".MuiFormHelperText-root.Mui-error, [role=alert], .MuiAlert-message",
              ),
            )
              .map((e) => (e.textContent ?? "").trim())
              .filter(Boolean)
              .join(" | ");
            const inputs = Array.from(
              document.querySelectorAll<HTMLInputElement>("input"),
            )
              .filter((i) => {
                const box = i.getBoundingClientRect();
                const cs = getComputedStyle(i);
                return (
                  box.width > 0 &&
                  box.height > 0 &&
                  cs.visibility !== "hidden" &&
                  cs.display !== "none" &&
                  cs.opacity !== "0"
                );
              })
              .slice(0, 8)
              .map((i) => {
                const lenLabel =
                  i.type === "password"
                    ? i.value.length
                      ? `${i.value.length} chars`
                      : "EMPTY"
                    : i.value
                      ? `"${i.value.slice(0, 24)}"`
                      : "EMPTY";
                return `${i.name || i.placeholder || i.type}=${lenLabel}`;
              })
              .join(", ");
            return { errs, inputs };
          });
          helper = diag.errs;
          fieldDump = diag.inputs;
        } catch {
          /* best-effort */
        }
        throw new ScrapeFailure(
          `NGTeco login did not complete — page still on ${url}.${helper ? ` Form said: ${helper}.` : ""}${fieldDump ? ` Visible inputs at submit: ${fieldDump}.` : ""} If a field is EMPTY despite us claiming we filled it, NGTeco renamed/duplicated the input — update fillLoginField. Otherwise the credentials in Settings → NGTeco are out of date.`,
          {},
        );
      }
      // Post-login: confirm we're actually on a logged-in surface.
      // The original code accepted "any nav element exists" as proof,
      // but the /login page itself has nav elements (language picker,
      // marketing footer), so a session that bounced straight back to
      // /login satisfied the check. Now we wait for the loggedInLandmark
      // *or* a nav with substantive text, AND re-check URL.
      try {
        await page.waitForSelector(sel.login.loggedInLandmark, {
          timeout: 4_000,
        });
      } catch {
        try {
          await page.waitForFunction(
            () => {
              const navs = Array.from(
                document.querySelectorAll("nav, aside, [role=navigation]"),
              );
              return navs.some(
                (n) => (n.textContent ?? "").trim().length > 40,
              );
            },
            null,
            { timeout: 6_000 },
          );
        } catch {
          await page.waitForTimeout(1_500);
        }
      }
      // Final hard check: the post-login waits succeeded, but did we
      // actually leave /login? A short SPA flash through a different
      // route and back to /login can satisfy the URL waitForFunction
      // above. Catch that here — without this, the navigation step
      // proceeds against a login page and surfaces a confusing
      // "couldn't find View Attendance Punch" error.
      assertNotOnLoginPage(page, "post-login confirmation");
    } else {
      // Persistent profile said "already logged in". Trust but verify:
      // make sure we aren't sitting on /login despite the DOM checks
      // (e.g., MUI hadn't hydrated yet so the password field wasn't
      // visible, but the URL has been /login the whole time).
      assertNotOnLoginPage(page, "initial page-load detection");
    }

    // SPA navigation only — page.goto() to a deep URL was nuking the
    // in-memory session token and bouncing back to /login, even right
    // after a successful login (verified via failure screenshot).
    // Click through the sidebar exactly like a human would: expand
    // Attendance, click View Attendance Punch.
    //
    // After login, give the dashboard a moment to hydrate the menu —
    // Element Plus renders the sidebar after the auth call returns.
    // Resilient nav: try the configured selector first, then fall back
    // through several text-based strategies. NGTeco rebuilt the sidebar
    // when they swapped Element Plus → MUI; the configured selector is
    // a CSS string that targets one DOM shape, but a getByText/role
    // fallback works against either. Past failure mode: a configured
    // `p:text-is("…")` selector timed out for 15s every poll because
    // the new MUI sidebar renders text in `<span>` not `<p>`.
    // Last gate before we start clicking sidebar links: confirm we
    // aren't on /login. If we are, the post-login confirmation has
    // already passed but the SPA bounced us back (rare, but happens
    // when NGTeco's session cookie is set but instantly invalidated
    // server-side — e.g., when an admin force-logged-out the account).
    assertNotOnLoginPage(page, "pre-navigation");

    if (sel.navigation.attendanceMenu) {
      try {
        await page.locator(sel.navigation.attendanceMenu).first().click({
          timeout: 5_000,
        });
      } catch {
        try {
          await page.getByText("Attendance", { exact: true }).first().click({
            timeout: 5_000,
          });
        } catch {
          // Menu may already be expanded, or it has no expandable
          // header at all. Continue — the link should still be
          // reachable.
        }
      }
    }

    // Wait for the sidebar to actually have *some* link text we can
    // reason about. Without this, we can race the SPA's lazy menu
    // mount and get a "no element found" timeout that looks like
    // NGTeco changed copy when really the SPA wasn't ready.
    try {
      await page.waitForFunction(
        () => {
          const nav = document.querySelector("nav, aside, [role=navigation]");
          return !!nav && (nav.textContent ?? "").trim().length > 20;
        },
        null,
        { timeout: 8_000 },
      );
    } catch {
      /* proceed anyway — we'll fall through to the failure capture
         which records the page so we can see what's there */
    }

    let clicked = false;
    if (sel.navigation.viewAttendancePunchLink) {
      try {
        await page.locator(sel.navigation.viewAttendancePunchLink).first().click({
          timeout: 6_000,
        });
        clicked = true;
      } catch {
        /* fall through to text/role-based fallbacks */
      }
    }
    if (!clicked) {
      try {
        await page.getByRole("link", { name: /view attendance punch/i }).first().click({
          timeout: 6_000,
        });
        clicked = true;
      } catch {
        /* not a link — try plain text */
      }
    }
    if (!clicked) {
      try {
        await page.getByText(/view attendance punch/i).first().click({
          timeout: 6_000,
        });
        clicked = true;
      } catch {
        /* fall through to broader variants — NGTeco has shipped
           "View Attendance Punch", "Attendance Punch", and just
           "Punch Records" at different points */
      }
    }
    if (!clicked) {
      // Wider net: any sidebar entry that looks punch-related. We
      // collect candidates so the failure path can log them.
      const variants: Array<RegExp> = [
        /view\s*attendance\s*punch/i,
        /attendance\s*punch/i,
        /punch\s*record/i,
        /view\s*punch/i,
      ];
      for (const re of variants) {
        try {
          await page.getByText(re).first().click({ timeout: 4_000 });
          clicked = true;
          break;
        } catch {
          /* try next variant */
        }
      }
    }
    if (!clicked) {
      // Snapshot what the sidebar actually contains so the failure
      // is diagnosable without an SSH-and-grep round trip. We dump
      // every top-level link/button label we can see.
      let sidebarLabels: string = "(unable to read)";
      try {
        sidebarLabels = await page.evaluate(() => {
          const root = document.querySelector("nav, aside, [role=navigation]") ?? document.body;
          const items = Array.from(
            root.querySelectorAll("a, [role=button], [role=menuitem], li, p, span"),
          );
          const seen = new Set<string>();
          const labels: string[] = [];
          for (const el of items) {
            const t = (el.textContent ?? "").trim().replace(/\s+/g, " ");
            if (t && t.length < 80 && !seen.has(t)) {
              seen.add(t);
              labels.push(t);
            }
            if (labels.length >= 60) break;
          }
          return labels.join(" | ");
        });
      } catch {
        /* keep placeholder */
      }
      throw new ScrapeFailure(
        `NGTeco navigation: could not find a "View Attendance Punch" link or any close variant. URL=${page.url()}. Sidebar labels seen: ${sidebarLabels}. If the sidebar looks empty, the saved login session is stale — clear /data/ngteco/profile inside the LXC (rm -rf) and retry; the next poll will log in fresh. If the labels show new copy, update lib/ngteco/selectors.json#navigation.viewAttendancePunchLink to match.`,
        {},
      );
    }
    await page.waitForSelector(sel.viewPunch.tableLandmark, {
      timeout: 15_000,
    });

    // Wait until at least one DATA row has text in its personId cell —
    // Element Plus tables often render a placeholder/loading row first
    // and the real data lands a beat later. Without this wait, the
    // scrape returns 0 events even though the table is about to fill in.
    try {
      await page.waitForFunction(
        ({ rowSel, idSel }: { rowSel: string; idSel: string }) => {
          const rows = document.querySelectorAll(rowSel);
          for (const row of Array.from(rows)) {
            const idCell = row.querySelector(idSel);
            const text = idCell?.textContent?.trim() ?? "";
            if (text && text.length > 0 && !/^[—–-]$/.test(text)) {
              return true;
            }
          }
          return false;
        },
        {
          rowSel: sel.viewPunch.rowsContainer,
          idSel: sel.viewPunch.personIdCell,
        },
        { timeout: 15_000 },
      );
    } catch {
      /* table is empty or never hydrated — proceed; we'll either return
         0 events legitimately or log a failure with the screenshot. */
    }

    const events: RawPunchEvent[] = [];
    const seenKeys = new Set<string>();
    let pages = 0;
    while (events.length < maxRows && pages < 50) {
      pages++;
      // MuiDataGrid uses ROW VIRTUALIZATION — even on a paginated grid,
      // only the rows currently in the viewport buffer render in the
      // DOM. A single page.evaluate snapshot misses any row that's
      // scrolled out. Last live poll: events_scraped=45 vs 68 visible
      // in the UI ≈ 1/3 of rows lost.
      //
      // Fix: scroll the virtual scroller in steps, accumulating unique
      // rows by personId+timestamp. Each scroll forces MUI to render
      // the next batch into the DOM. We stop when the row count stops
      // growing OR we've collected at least the page-size number of
      // rows (whichever first).
      const evalArgs = {
        rowSel: sel.viewPunch.rowsContainer,
        nameSel: sel.viewPunch.personNameCell,
        idSel: sel.viewPunch.personIdCell,
        dateSel: sel.viewPunch.punchDateCell,
        timeSel: sel.viewPunch.punchTimeCell,
        verifySel: sel.viewPunch.verifyTypeCell,
        tzSel: sel.viewPunch.timezoneCell,
        sourceSel: sel.viewPunch.sourceCell,
      };
      type RowRaw = {
        personName: string;
        personId: string;
        dateRaw: string;
        timeRaw: string;
        verifyType: string;
        tzRaw: string;
        source: string;
      };
      const collectVisible = async (): Promise<RowRaw[]> => {
        const out = await page.evaluate(
          (a: typeof evalArgs) => {
            const result: Array<Record<string, string>> = [];
            const rows = document.querySelectorAll(a.rowSel);
            for (const row of Array.from(rows)) {
              const get = (s: string) =>
                (row.querySelector(s) as HTMLElement | null)?.textContent?.trim() ??
                "";
              result.push({
                personName: get(a.nameSel),
                personId: get(a.idSel),
                dateRaw: get(a.dateSel),
                timeRaw: get(a.timeSel),
                verifyType: get(a.verifySel),
                tzRaw: get(a.tzSel),
                source: get(a.sourceSel),
              });
            }
            return result;
          },
          evalArgs,
        );
        return out as RowRaw[];
      };
      const pageKeys = new Set<string>();
      const pageRows: RowRaw[] = [];
      const scrollStep = async (offset: number): Promise<void> => {
        await page.evaluate((y: number) => {
          const scroller = document.querySelector(
            ".MuiDataGrid-virtualScroller",
          ) as HTMLElement | null;
          if (scroller) scroller.scrollTop = y;
        }, offset);
      };
      // Reset scroll, then scan top → bottom in chunks. The virtual
      // scroller's total height equals (rowCount × rowHeight); each
      // window the buffer renders ~30 rows, so 200px steps comfortably
      // overlap and ensure no row is skipped.
      await scrollStep(0);
      await page.waitForTimeout(150);
      let stableCount = 0;
      let lastSize = 0;
      const maxScrollSteps = 60; // safety cap
      for (let step = 0; step < maxScrollSteps; step++) {
        const visible = await collectVisible();
        for (const r of visible) {
          const key = `${r.personId}|${r.dateRaw}|${r.timeRaw}`;
          if (!r.personId || !r.dateRaw || !r.timeRaw) continue;
          if (pageKeys.has(key)) continue;
          pageKeys.add(key);
          pageRows.push(r);
        }
        // Advance the scroller. End-of-list reached → MUI will clamp
        // scrollTop, the size stops growing, we exit.
        const reached = await page.evaluate(() => {
          const sc = document.querySelector(
            ".MuiDataGrid-virtualScroller",
          ) as HTMLElement | null;
          if (!sc) return true;
          const next = sc.scrollTop + Math.max(200, sc.clientHeight - 80);
          sc.scrollTop = next;
          return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
        });
        await page.waitForTimeout(120);
        if (pageRows.length === lastSize) {
          stableCount++;
        } else {
          stableCount = 0;
          lastSize = pageRows.length;
        }
        if (reached && stableCount >= 1) break;
        if (stableCount >= 3) break; // no growth for 3 cycles
      }
      // Reset to the top so the next pagination click lands on a clean
      // viewport (avoids React state weirdness).
      await scrollStep(0);

      for (const r of pageRows) {
        const punchAt = composeIso(r.dateRaw, r.timeRaw, r.tzRaw);
        if (!punchAt) continue;
        const key = `${r.personId}|${punchAt}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        events.push({
          personId: r.personId,
          personName: r.personName,
          punchAt,
          verifyType: r.verifyType,
          source: r.source,
        });
      }
      // Try to advance to the next pagination page.
      const next = page.locator(sel.viewPunch.nextPageButton).first();
      const visible = (await next.count()) > 0 && (await next.isEnabled().catch(() => false));
      if (!visible) break;
      await Promise.all([
        page.waitForTimeout(400), // small debounce for the pagination redraw
        next.click().catch(() => {}),
      ]);
      // Wait for the new page's first row to have hydrated content
      // (otherwise our scroll-and-collect loop will read placeholders
      // and exit early).
      try {
        await page.waitForFunction(
          ({ rowSel, idSel }: { rowSel: string; idSel: string }) => {
            const rows = document.querySelectorAll(rowSel);
            for (const row of Array.from(rows)) {
              const idCell = row.querySelector(idSel);
              const text = idCell?.textContent?.trim() ?? "";
              if (text && !/^[—–-]$/.test(text)) return true;
            }
            return false;
          },
          {
            rowSel: sel.viewPunch.rowsContainer,
            idSel: sel.viewPunch.personIdCell,
          },
          { timeout: 8_000 },
        );
      } catch {
        /* page may have ended unexpectedly — break out */
        break;
      }
    }

    // Diagnostics — when the scrape technically succeeded (no thrown
    // error) but yielded zero events, capture a screenshot + HTML dump
    // to the same failure-artifacts dir so the admin can inspect what
    // the page actually looked like. The summary still returns ok:true
    // and pairsInserted: 0 — the scraper isn't lying about success,
    // we're just helping the admin verify "is the table really empty
    // right now" vs "is my selector broken".
    if (events.length === 0) {
      try {
        const debugDir = join(FAILURES_DIR, `${input.runId}-empty`);
        if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
        await page.screenshot({
          path: join(debugDir, "page.png"),
          fullPage: true,
        });
        const html = await page.content();
        const { writeFileSync } = await import("node:fs");
        writeFileSync(join(debugDir, "page.html"), html);
      } catch {
        /* best-effort */
      }
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
