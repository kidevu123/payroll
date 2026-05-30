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
    /** Deep link — preferred over sidebar clicks when present. */
    viewAttendancePunchUrl?: string;
    mendAttendancePunchUrl?: string;
    attendanceReportUrl?: string;
    reportMenu?: string;
    attendanceMenu?: string;
    viewAttendancePunchLink?: string;
    mendAttendancePunchLink?: string;
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
    showMendedRecordsToggle?: string;
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
  return pathname
    .split("/")
    .filter(Boolean)
    .some((seg) => seg.toLowerCase() === "login");
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
  if (
    sel.login.username &&
    (await page.locator(sel.login.username).count()) > 0
  ) {
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

/** Fill a login field, surviving React's controlled-input quirk.
 *
 *  History of failures, in order:
 *    1. Original used `page.fill(configured_css)` — silently mis-
 *       targeted hidden shadow inputs that share name="username"
 *       with the visible MUI control. inputValue() read back fine,
 *       but MUI's validation said "This field is required!".
 *    2. Visible-filtered locator + post-fill audit caught the
 *       shadow-input case, but introduced a new failure: even
 *       when fill() landed in the visible input and audit briefly
 *       saw the value, MUI's React state didn't update. On the
 *       very next render React's controlled-input mechanism
 *       overwrote our value with its own (empty) state, so by
 *       submit time the field read EMPTY again.
 *
 *  Root cause of (2): React tracks controlled-input values via
 *  HTMLInputElement.prototype's value setter, which it patches.
 *  Playwright's fill() goes through that path most of the time,
 *  but with MUI v5's TextField wrapping + adornments + theme
 *  overrides, the synthetic input event is intermittently NOT
 *  registered as a "real change". This is documented:
 *    • facebook/react#11600 — dispatchEvent('input') doesn't
 *      trigger onChange unless the value was set via the original
 *      prototype setter
 *    • microsoft/playwright#36395 — fill not sticking, regression
 *    • microsoft/playwright#15925 — second fill clears the first
 *    • mui/material-ui#46734 — recent MUI Autocomplete + fill
 *      regression confirming this class of bug is alive in 2026
 *
 *  Fix used here:
 *    • Strategy 1 — `pressSequentially` per character with a tiny
 *      delay. This produces real keydown/keypress/input/keyup
 *      events that React MUST honour. Equivalent to a human
 *      typing. Recommended by Playwright docs for React/MUI.
 *    • Strategy 2 — native-prototype-setter + bubbled input event
 *      via page.evaluate. The documented React workaround when
 *      keystrokes still don't stick.
 *    • Audit step is unchanged: we only return success if a VISIBLE
 *      input matching the audit selector has our value AT THE TIME
 *      OF AUDIT.
 *
 *  A separate pre-submit re-check (in the caller) verifies values
 *  are STILL there right before clicking Login, and re-fills via
 *  the prototype-setter path if the field went empty. */
async function fillLoginField(
  page: import("playwright-core").Page,
  kind: "username" | "password",
  _configuredSelector: string | undefined,
  value: string,
): Promise<void> {
  // _configuredSelector is intentionally unused now: every selector
  // that previously appeared as configured was a CSS string targeting
  // a single DOM shape, and the failures that motivated the rewrite
  // were never about the selector — they were about how the value
  // gets into the input. Keeping the parameter for caller compat.
  void _configuredSelector;

  const auditAny =
    kind === "username"
      ? `input[name="username"], input[type="email"], input[name*="email" i], input[name*="user" i]`
      : `input[name="password"], input[type="password"]`;

  /** Verify at least one VISIBLE input matching `auditSelector` has
   *  the exact value we wrote. Catches the hidden-shadow-input case. */
  const auditFill = async (): Promise<boolean> => {
    try {
      return await page.evaluate(
        ({ sel, expected }: { sel: string; expected: string }) => {
          const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>(sel),
          );
          for (const inp of inputs) {
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
        { sel: auditAny, expected: value },
      );
    } catch {
      return false;
    }
  };

  /** Pick the visible input locator. We try several strategies but
   *  ALWAYS act on the same single resolved locator across the
   *  click/clear/type sequence to avoid racing locator resolution. */
  const resolveVisibleLocator = async (): Promise<
    import("playwright-core").Locator | null
  > => {
    const candidates: Array<() => import("playwright-core").Locator> = [
      () =>
        page.locator(
          kind === "username"
            ? 'input[name="username"]:visible'
            : 'input[name="password"]:visible',
        ),
      () =>
        page.getByRole("textbox", {
          name: kind === "username" ? /email|account|user/i : /password/i,
        }),
      () =>
        page.getByPlaceholder(kind === "username" ? "Email" : "Password", {
          exact: true,
        }),
      () =>
        page.locator(
          kind === "username"
            ? 'input[type="email"]:visible, input[name*="email" i]:visible, input[name*="user" i]:visible'
            : 'input[type="password"]:visible',
        ),
    ];
    for (const make of candidates) {
      const loc = make().first();
      const count = await loc.count().catch(() => 0);
      if (count > 0) return loc;
    }
    return null;
  };

  const loc = await resolveVisibleLocator();
  if (!loc) {
    // No visible input at all — fall through to the diagnostic dump
    // at the bottom of this function.
  } else {
    // Strategy 1: click → keyboard.pressSequentially. Real keydown/
    // input/keyup events MUI's React onChange MUST honour. This is
    // what Playwright's docs recommend for React-controlled inputs.
    try {
      await loc.click({ timeout: 5_000 });
      // Clear without using fill() — select-all + delete is the
      // keyboard equivalent and goes through React's event path.
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Meta+A"); // mac equivalent (no-op on Linux)
      await page.keyboard.press("Delete");
      await loc.pressSequentially(value, { delay: 15, timeout: 8_000 });
      // Blur to let MUI commit any pending state. Some MUI configs
      // only validate on blur; without this the next focus event
      // on the agreement checkbox can race the value commit.
      await loc.evaluate((el) => (el as HTMLInputElement).blur());
      if (await auditFill()) return;
    } catch {
      /* fall through to native-setter fallback */
    }

    // Strategy 2: native-prototype-setter + bubbled input event,
    // executed inside the browser. This is THE documented React
    // workaround (facebook/react#11600). When keystrokes don't
    // stick (extremely unusual but possible with autoFill polyfills
    // or InputAdornment wrappers intercepting events), this forces
    // React's value tracker to register a change.
    try {
      await loc.evaluate((el, v) => {
        const input = el as HTMLInputElement;
        const proto = Object.getPrototypeOf(input);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        const fallbackSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        const apply = setter ?? fallbackSetter;
        if (apply) apply.call(input, v);
        else input.value = v;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur();
      }, value);
      if (await auditFill()) return;
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
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>("input"),
      );
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

/** Right before submit, verify that a visible input still has the
 *  value we wrote. If it doesn't (MUI/React reconciled it back to
 *  empty), force a re-fill via the native prototype setter + bubbled
 *  input event. This is the documented React workaround
 *  (facebook/react#11600) and bypasses any React-controlled-input
 *  state issues that swallowed our earlier keystroke-based fill. */
async function primeIfCleared(
  page: import("playwright-core").Page,
  kind: "username" | "password",
  value: string,
): Promise<void> {
  const auditAny =
    kind === "username"
      ? `input[name="username"], input[type="email"], input[name*="email" i], input[name*="user" i]`
      : `input[name="password"], input[type="password"]`;
  try {
    const stillFilled = await page.evaluate(
      ({ sel, expected }: { sel: string; expected: string }) => {
        const inputs = Array.from(
          document.querySelectorAll<HTMLInputElement>(sel),
        );
        for (const inp of inputs) {
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
      { sel: auditAny, expected: value },
    );
    if (stillFilled) return;
    // Cleared — re-prime via the native setter against the FIRST
    // visible matching input.
    await page.evaluate(
      ({ sel, v }: { sel: string; v: string }) => {
        const inputs = Array.from(
          document.querySelectorAll<HTMLInputElement>(sel),
        );
        for (const inp of inputs) {
          const box = inp.getBoundingClientRect();
          const cs = getComputedStyle(inp);
          const visible =
            box.width > 0 &&
            box.height > 0 &&
            cs.visibility !== "hidden" &&
            cs.display !== "none" &&
            cs.opacity !== "0";
          if (!visible) continue;
          const proto = Object.getPrototypeOf(inp);
          const setter =
            Object.getOwnPropertyDescriptor(proto, "value")?.set ??
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
              ?.set;
          if (setter) setter.call(inp, v);
          else inp.value = v;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return; // first visible match is enough
        }
      },
      { sel: auditAny, v: value },
    );
  } catch {
    /* best-effort — if it still fails, the post-submit error path
       reports the empty field with the visible-inputs dump and the
       operator can act on it directly. */
  }
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
      .locator("label")
      .filter({ hasText: /i have read and agree/i })
      .locator('input[type="checkbox"]'),
    // Last-ditch: of the two checkboxes in the login form, the
    // agreement one is the FIRST (Remember-Me is second).
    page.locator('input[type="checkbox"]').first(),
  ];
  for (const cb of candidates) {
    try {
      if (!(await cb.count())) continue;
      const checked = await cb
        .first()
        .isChecked()
        .catch(() => false);
      if (checked) return;
      await cb.first().check({ timeout: 4_000, force: true });
      const nowChecked = await cb
        .first()
        .isChecked()
        .catch(() => false);
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

type PlaywrightPage = import("playwright-core").Page;

function ngtecoUrl(portalUrl: string, path: string): string {
  return new URL(path, portalUrl).toString();
}

function pathnameMatches(page: PlaywrightPage, fragment: string): boolean {
  try {
    return new URL(page.url()).pathname.includes(fragment);
  } catch {
    return false;
  }
}

async function expandSidebarSection(
  page: PlaywrightPage,
  labels: Array<string | undefined>,
): Promise<void> {
  for (const label of labels) {
    if (!label) continue;
    try {
      await page.locator(label).first().click({ timeout: 4_000 });
      await page.waitForTimeout(300);
      return;
    } catch {
      try {
        await page.getByText(label, { exact: true }).first().click({
          timeout: 4_000,
        });
        await page.waitForTimeout(300);
        return;
      } catch {
        /* section may already be expanded or use a different wrapper */
      }
    }
  }
}

async function clickSidebarEntry(
  page: PlaywrightPage,
  opts: {
    configuredSelector?: string;
    textPatterns: RegExp[];
  },
): Promise<boolean> {
  if (opts.configuredSelector) {
    try {
      await page.locator(opts.configuredSelector).first().click({
        timeout: 5_000,
      });
      return true;
    } catch {
      /* fall through */
    }
  }
  for (const re of opts.textPatterns) {
    try {
      await page.getByRole("link", { name: re }).first().click({
        timeout: 4_000,
      });
      return true;
    } catch {
      /* not a link */
    }
    try {
      await page.getByText(re).first().click({ timeout: 4_000 });
      return true;
    } catch {
      /* try next pattern */
    }
  }
  return false;
}

async function readSidebarLabels(page: PlaywrightPage): Promise<string> {
  try {
    return await page.evaluate(() => {
      const root =
        document.querySelector("nav, aside, [role=navigation]") ??
        document.body;
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
    return "(unable to read)";
  }
}

async function gotoNgtecoPath(
  page: PlaywrightPage,
  portalUrl: string,
  path: string,
): Promise<void> {
  await page.goto(ngtecoUrl(portalUrl, path), {
    waitUntil: "domcontentloaded",
  });
}

async function isViewPunchPageReady(
  page: PlaywrightPage,
  sel: Selectors,
): Promise<boolean> {
  if (!sel.viewPunch) return false;
  if (pathnameMatches(page, "/att/timecard/transaction")) return true;
  return (await page.locator(sel.viewPunch.tableLandmark).count()) > 0;
}

async function isMendPunchPageReady(page: PlaywrightPage): Promise<boolean> {
  if (pathnameMatches(page, "/att/timecard/manual-log")) return true;
  return (await page.getByText(/mend attendance punch/i).count()) > 0;
}

async function navigateToViewAttendancePunch(
  page: PlaywrightPage,
  portalUrl: string,
  sel: Selectors,
): Promise<void> {
  assertNotOnLoginPage(page, "pre-navigation");

  if (sel.navigation.viewAttendancePunchUrl) {
    await gotoNgtecoPath(page, portalUrl, sel.navigation.viewAttendancePunchUrl);
    assertNotOnLoginPage(page, "view-attendance-punch deep link");
    if (await isViewPunchPageReady(page, sel)) return;
  }

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
    /* proceed — failure path captures what's on screen */
  }

  await expandSidebarSection(page, [
    sel.navigation.reportMenu,
    sel.navigation.attendanceMenu,
    "Report",
  ]);

  const clicked = await clickSidebarEntry(page, {
    ...(sel.navigation.viewAttendancePunchLink
      ? { configuredSelector: sel.navigation.viewAttendancePunchLink }
      : {}),
    textPatterns: [
      /view\s*attendance\s*punch/i,
      /attendance\s*punch/i,
      /punch\s*record/i,
      /view\s*punch/i,
    ],
  });

  if (!clicked) {
    const sidebarLabels = await readSidebarLabels(page);
    throw new ScrapeFailure(
      `NGTeco navigation: could not reach View Attendance Punch. URL=${page.url()}. Sidebar labels seen: ${sidebarLabels}. If the sidebar looks empty, the saved login session is stale — clear /data/ngteco/profile inside the LXC (rm -rf) and retry; the next poll will log in fresh. If the labels show new copy, update lib/ngteco/selectors.json#navigation.viewAttendancePunchUrl or viewAttendancePunchLink.`,
      {},
    );
  }

  assertNotOnLoginPage(page, "post-sidebar navigation");
  if (!(await isViewPunchPageReady(page, sel))) {
    await page.waitForSelector(sel.viewPunch!.tableLandmark, {
      timeout: 15_000,
    });
  }
}

async function navigateToMendAttendancePunch(
  page: PlaywrightPage,
  portalUrl: string,
  sel: Selectors,
): Promise<void> {
  assertNotOnLoginPage(page, "pre-mend-navigation");

  if (sel.navigation.mendAttendancePunchUrl) {
    await gotoNgtecoPath(page, portalUrl, sel.navigation.mendAttendancePunchUrl);
    assertNotOnLoginPage(page, "mend-attendance-punch deep link");
    if (await isMendPunchPageReady(page)) return;
  }

  await expandSidebarSection(page, [
    sel.navigation.attendanceMenu,
    "Attendance",
  ]);

  const clicked = await clickSidebarEntry(page, {
    ...(sel.navigation.mendAttendancePunchLink
      ? { configuredSelector: sel.navigation.mendAttendancePunchLink }
      : {}),
    textPatterns: [/mend attendance punch/i, /manual log/i, /mend punch/i],
  });

  if (!clicked) {
    const sidebarLabels = await readSidebarLabels(page);
    throw new ScrapeFailure(
      `NGTeco navigation: could not reach Mend Attendance Punch. URL=${page.url()}. Sidebar labels seen: ${sidebarLabels}. Update lib/ngteco/selectors.json#navigation.mendAttendancePunchUrl or mendAttendancePunchLink.`,
      {},
    );
  }

  assertNotOnLoginPage(page, "post-mend-sidebar navigation");
  if (!(await isMendPunchPageReady(page))) {
    await page
      .getByText(/mend attendance punch|person\s*id/i)
      .first()
      .waitFor({ timeout: 15_000 });
  }
}

/** Include manually mended punches in the View Attendance Punch grid. */
async function ensureShowMendedRecords(
  page: PlaywrightPage,
  sel: Selectors,
): Promise<void> {
  const candidates: import("playwright-core").Locator[] = [
    page.getByRole("switch", { name: /show mended records/i }),
    page.getByLabel(/show mended records/i),
  ];
  if (sel.viewPunch?.showMendedRecordsToggle) {
    candidates.unshift(page.locator(sel.viewPunch.showMendedRecordsToggle));
  }
  for (const candidate of candidates) {
    try {
      if ((await candidate.count()) === 0) continue;
      const target = candidate.first();
      const role = await target.getAttribute("role").catch(() => null);
      const type = await target.getAttribute("type").catch(() => null);
      if (role === "switch" || type === "checkbox") {
        const checked = await target.isChecked().catch(() => false);
        if (!checked) await target.click({ timeout: 4_000, force: true });
        return;
      }
      const switchNearLabel = target
        .locator("xpath=ancestor-or-self::*[1]")
        .locator('.MuiSwitch-root input[type="checkbox"], input[type="checkbox"]')
        .first();
      if ((await switchNearLabel.count()) > 0) {
        const checked = await switchNearLabel.isChecked().catch(() => false);
        if (!checked) await switchNearLabel.click({ timeout: 4_000, force: true });
        return;
      }
      await target.click({ timeout: 4_000 });
      return;
    } catch {
      /* try next candidate */
    }
  }
}

async function navigateToAttendanceReport(
  page: PlaywrightPage,
  portalUrl: string,
  sel: Selectors,
): Promise<void> {
  if (sel.navigation.attendanceReportUrl) {
    await gotoNgtecoPath(page, portalUrl, sel.navigation.attendanceReportUrl);
    assertNotOnLoginPage(page, "attendance-report deep link");
    if (
      (await page.locator(sel.report.fromDate).count()) > 0 ||
      (await page.locator(sel.report.exportCsvButton).count()) > 0
    ) {
      return;
    }
  }

  await expandSidebarSection(page, [
    sel.navigation.reportMenu,
    sel.navigation.reportsLink,
    "Report",
  ]);
  const clicked = await clickSidebarEntry(page, {
    configuredSelector: sel.navigation.punchReportLink,
    textPatterns: [
      /attendance report/i,
      /punch.*report/i,
      /timecard management/i,
    ],
  });
  if (!clicked) {
    try {
      await page.click(sel.navigation.reportsLink, { timeout: 5_000 });
      await page.click(sel.navigation.punchReportLink, { timeout: 5_000 });
      return;
    } catch {
      const sidebarLabels = await readSidebarLabels(page);
      throw new ScrapeFailure(
        `NGTeco navigation: could not reach the attendance CSV export page. URL=${page.url()}. Sidebar labels seen: ${sidebarLabels}. Update lib/ngteco/selectors.json#navigation.attendanceReportUrl or punchReportLink.`,
        {},
      );
    }
  }
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
  const { mkdirSync, existsSync } = await import(
    /* webpackIgnore: true */ "node:fs"
  );
  const { join } = await import(/* webpackIgnore: true */ "node:path");
  const PROFILE_DIR = join(STORAGE_ROOT, "profile");
  const FAILURES_DIR = join(STORAGE_ROOT, "failures");
  const sel = await loadSelectors();
  const t0 = Date.now();
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const failureDir = join(FAILURES_DIR, input.runId);

  const { chromium } =
    (await import("playwright")) as typeof import("playwright");
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
      const { writeFileSync } = await import(
        /* webpackIgnore: true */ "node:fs"
      );
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
            await page.locator(clickTarget).first().click({ timeout: 5_000 });
          }
        } catch {
          /* no checkbox visible / already accepted */
        }
      }
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded" })
          .catch(() => {}),
        page.click(sel.login.submit),
      ]);
      await page.waitForSelector(sel.login.loggedInLandmark, {
        timeout: 15_000,
      });
    }

    // Navigate to the attendance CSV export report.
    await navigateToAttendanceReport(page, input.portalUrl, sel);

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
  const { mkdirSync, existsSync } = await import(
    /* webpackIgnore: true */ "node:fs"
  );
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

  const { chromium } =
    (await import("playwright")) as typeof import("playwright");
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
      const { writeFileSync } = await import(
        /* webpackIgnore: true */ "node:fs"
      );
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
      await fillLoginField(
        page,
        "username",
        sel.login.username,
        input.username,
      );
      await fillLoginField(
        page,
        "password",
        sel.login.password,
        input.password,
      );
      // Tick the User Agreement / Privacy Policy checkbox — NGTeco's
      // MUI login disables the submit button until it's checked, so
      // skipping this step silently kept the form on /login.
      await ensureAgreementChecked(page);
      // Pre-submit re-check. The agreement checkbox click can blur a
      // freshly-typed input; in some MUI configs, a blur with React
      // state-not-yet-reconciled flushes the value back to empty (this
      // was the exact failure the operator hit: "Visible inputs at
      // submit: username=EMPTY, password=EMPTY"). Read the visible
      // values right before clicking Login; if either dropped, re-prime
      // through the native-setter + dispatch-event path which forces
      // React's value tracker to register a change.
      await primeIfCleared(page, "username", input.username);
      await primeIfCleared(page, "password", input.password);
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded" })
          .catch(() => {}),
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
              return navs.some((n) => (n.textContent ?? "").trim().length > 40);
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

    await navigateToViewAttendancePunch(page, input.portalUrl, sel);
    await ensureShowMendedRecords(page, sel);
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
    // 200-page cap (was 50). At ~100 rows/page on NGTeco's View
    // Attendance Punch grid that's ~20k rows — enough to walk back
    // ~30 days at a 50-employee × 4-punch/day density. Auto-backfill
    // and the catastrophic "owner was out for a month" recovery
    // path both depend on this; 50 capped recovery at ~5 days.
    while (events.length < maxRows && pages < 200) {
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
        const out = await page.evaluate((a: typeof evalArgs) => {
          const result: Array<Record<string, string>> = [];
          const rows = document.querySelectorAll(a.rowSel);
          for (const row of Array.from(rows)) {
            const get = (s: string) =>
              (
                row.querySelector(s) as HTMLElement | null
              )?.textContent?.trim() ?? "";
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
        }, evalArgs);
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
      const visible =
        (await next.count()) > 0 && (await next.isEnabled().catch(() => false));
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

export type ManualAttendancePunchInput = {
  portalUrl: string;
  username: string;
  password: string;
  headless: boolean;
  runId: string;
  personId: string;
  personName: string;
  /** NGTeco manual log display date, MM/DD/YYYY. */
  punchDate: string;
  /** NGTeco manual log display time, HH:mm:ss. */
  punchTime: string;
  /** NGTeco manual log offset, e.g. -04:00. */
  timeZoneOffset: string;
  /** IANA timezone used by the browser session; NGTeco derives manual-log offset from it. */
  browserTimeZone?: string;
  remarks: string;
};

export async function addManualAttendancePunch(
  input: ManualAttendancePunchInput,
): Promise<void> {
  const { mkdirSync, existsSync, writeFileSync } = await import(
    /* webpackIgnore: true */ "node:fs"
  );
  const { join } = await import(/* webpackIgnore: true */ "node:path");
  const PROFILE_DIR = join(STORAGE_ROOT, "profile");
  const FAILURES_DIR = join(STORAGE_ROOT, "failures");
  const sel = await loadSelectors();
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const failureDir = join(FAILURES_DIR, input.runId);

  const { chromium } =
    (await import("playwright")) as typeof import("playwright");
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1600, height: 950 },
    locale: "en-US",
    timezoneId: input.browserTimeZone ?? "America/New_York",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);

  const captureFailure = async (reason: string): Promise<never> => {
    if (!existsSync(failureDir)) mkdirSync(failureDir, { recursive: true });
    const screenshotPath = join(failureDir, "page.png");
    const htmlPath = join(failureDir, "page.html");
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      writeFileSync(htmlPath, await page.content());
    } catch {
      /* best-effort */
    }
    await ctx.close();
    throw new ScrapeFailure(reason, { screenshotPath, htmlPath });
  };

  const humanFill = async (
    locator: import("playwright-core").Locator,
    value: string,
    pressEnter = false,
  ) => {
    const target = locator.first();
    await target.click({ timeout: 5_000 });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Delete");
    await target.pressSequentially(value, { delay: 10, timeout: 8_000 });
    if (pressEnter) await page.keyboard.press("Enter");
  };

  const fillByHints = async (
    root: import("playwright-core").Locator,
    hints: RegExp[],
    value: string,
    opts: { enter?: boolean; textarea?: boolean } = {},
  ) => {
    const candidates: import("playwright-core").Locator[] = [];
    for (const hint of hints) {
      candidates.push(root.getByLabel(hint));
      candidates.push(root.getByPlaceholder(hint));
    }
    const words = Array.from(
      new Set(
        hints
          .flatMap((h) => h.source.split(/[^a-zA-Z]+/))
          .filter((w) => w.length >= 4),
      ),
    );
    for (const word of words) {
      candidates.push(
        root.locator(
          opts.textarea
            ? `textarea[placeholder*="${word}" i]:visible, textarea[name*="${word}" i]:visible`
            : `input[placeholder*="${word}" i]:visible, input[name*="${word}" i]:visible, input[aria-label*="${word}" i]:visible`,
        ),
      );
    }
    for (const candidate of candidates) {
      if ((await candidate.count().catch(() => 0)) === 0) continue;
      try {
        await humanFill(candidate, value, opts.enter);
        return;
      } catch {
        /* try next candidate */
      }
    }
    const hintList = hints.map((h) => h.source).join(", ");
    throw new Error(
      `Could not fill NGTeco manual punch field matching ${hintList}`,
    );
  };

  const fillTimezoneOffset = async (
    root: import("playwright-core").Locator,
    visibleInputs: import("playwright-core").Locator,
  ) => {
    const directCandidates: import("playwright-core").Locator[] = [
      root.getByLabel(/timezone/i),
      root.getByLabel(/time\s*zone/i),
      root.getByPlaceholder(/timezone/i),
      root.getByPlaceholder(/time\s*zone/i),
      root.locator(
        [
          'input[name*="timezone" i]:visible',
          'input[name*="time_zone" i]:visible',
          'input[aria-label*="timezone" i]:visible',
          'input[aria-label*="time zone" i]:visible',
          'input[placeholder*="timezone" i]:visible',
          'input[placeholder*="time zone" i]:visible',
        ].join(", "),
      ),
    ];

    const tryCandidate = async (
      candidate: import("playwright-core").Locator,
    ): Promise<boolean> => {
      if ((await candidate.count().catch(() => 0)) === 0) return false;
      const target = candidate.first();
      try {
        await humanFill(target, input.timeZoneOffset, true);
        await page.waitForTimeout(250);
        const value = await target.inputValue().catch(() => "");
        if (value.includes(input.timeZoneOffset)) return true;
        const text = await root.innerText().catch(() => "");
        return text.includes(input.timeZoneOffset);
      } catch {
        return false;
      }
    };

    for (const candidate of directCandidates) {
      if (await tryCandidate(candidate)) return;
    }

    const count = await visibleInputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = visibleInputs.nth(i);
      const value = await candidate.inputValue().catch(() => "");
      const label =
        (await candidate.getAttribute("aria-label").catch(() => "")) ?? "";
      const placeholder =
        (await candidate.getAttribute("placeholder").catch(() => "")) ?? "";
      const looksLikeTimezone =
        /timezone|time\s*zone/i.test(`${label} ${placeholder}`) ||
        /^[+-]\d{2}:\d{2}$/.test(value) ||
        /^GMT[+-]\d{2}:?\d{2}$/i.test(value);
      if (!looksLikeTimezone) continue;
      if (await tryCandidate(candidate)) return;
    }

    if (count >= 4 && (await tryCandidate(visibleInputs.nth(3)))) return;
    // Current NGTeco manual-log form has no visible timezone field. In that
    // build it derives the offset from the browser timezone, configured on the
    // Playwright context above. The post-submit exact-row check still verifies
    // the saved row has the requested offset.
  };

  const expectedManualRowVisible = async (): Promise<boolean> =>
    page
      .locator("tr, [role='row']")
      .filter({ hasText: input.personId })
      .filter({ hasText: input.punchDate })
      .filter({ hasText: input.punchTime })
      .filter({ hasText: input.timeZoneOffset })
      .count()
      .then((count) => count > 0)
      .catch(() => false);

  const waitForExpectedManualRow = async (
    timeoutMs = 20_000,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await expectedManualRowVisible()) return true;
      await page.waitForTimeout(500);
    }
    return expectedManualRowVisible();
  };

  const waitForManualLogGridRefresh = async (): Promise<void> => {
    await page
      .waitForFunction(
        () => {
          const text = document.body?.textContent ?? "";
          return !/0\s*[–-]\s*0\s+of\s+0/.test(text);
        },
        null,
        { timeout: 12_000 },
      )
      .catch(() => undefined);
  };

  try {
    await page.goto(input.portalUrl, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(
        () => (document.body?.textContent ?? "").trim().length > 50,
        null,
        { timeout: 8_000 },
      );
    } catch {
      /* downstream checks will diagnose */
    }
    if ((await page.locator(sel.challenge.twoFactorLandmark).count()) > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("TWO_FACTOR");
    }
    if ((await page.locator(sel.challenge.captchaLandmark).count()) > 0) {
      await ctx.close();
      throw new ChallengeDetectedError("CAPTCHA");
    }

    if (await detectLoginPage(page, sel)) {
      await fillLoginField(
        page,
        "username",
        sel.login.username,
        input.username,
      );
      await fillLoginField(
        page,
        "password",
        sel.login.password,
        input.password,
      );
      await ensureAgreementChecked(page);
      await primeIfCleared(page, "username", input.username);
      await primeIfCleared(page, "password", input.password);
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded" })
          .catch(() => {}),
        clickLoginSubmit(page, sel.login.submit),
      ]);
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
    }
    assertNotOnLoginPage(page, "manual punch login");

    await navigateToMendAttendancePunch(page, input.portalUrl, sel);
    assertNotOnLoginPage(page, "manual punch page");
    await page
      .getByText(/person\s*id|mend attendance punch/i)
      .first()
      .waitFor({ timeout: 15_000 });
    await waitForManualLogGridRefresh();

    if (await expectedManualRowVisible()) {
      await ctx.close();
      return;
    }

    const wrongTimezoneRows = page
      .locator("tr, [role='row']")
      .filter({ hasText: input.personId })
      .filter({ hasText: input.punchDate })
      .filter({ hasText: input.punchTime });
    const wrongTimezoneCount = await wrongTimezoneRows.count().catch(() => 0);
    for (let i = 0; i < wrongTimezoneCount; i++) {
      const row = wrongTimezoneRows.nth(i);
      const text = await row.innerText().catch(() => "");
      if (text.includes(input.timeZoneOffset)) continue;
      const deleteButton = row.getByText(/^delete$/i).last();
      if ((await deleteButton.count().catch(() => 0)) === 0) continue;
      await deleteButton.click({ timeout: 8_000 });
      const confirm = page
        .getByRole("button", { name: /^(ok|confirm|delete|yes)$/i })
        .last();
      await confirm.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    await page.getByText(/^add$/i).last().click({ timeout: 10_000 });
    const dialogCandidates = page.locator(
      '[role="dialog"], .MuiDialog-root, .el-dialog, .ant-modal',
    );
    const dialog =
      (await dialogCandidates.count().catch(() => 0)) > 0
        ? dialogCandidates.last()
        : page.locator("body");

    const visibleInputs = dialog.locator("input:visible");
    if ((await visibleInputs.count().catch(() => 0)) >= 3) {
      await visibleInputs.nth(0).click({ timeout: 5_000 });
      const personDrawer = page.locator(".MuiDrawer-root").last();
      await personDrawer.waitFor({ timeout: 8_000 });
      await humanFill(
        personDrawer.locator("input:visible").first(),
        input.personName,
      );
      await page.waitForTimeout(700);
      await personDrawer
        .getByText(input.personName, { exact: false })
        .last()
        .click({
          timeout: 8_000,
        });
      await personDrawer
        .getByText(/^confirm$/i)
        .last()
        .click({ timeout: 8_000 });
      await page.waitForTimeout(500);
      await humanFill(visibleInputs.nth(1), input.punchDate);
      await humanFill(visibleInputs.nth(2), input.punchTime.slice(0, 5));
      await fillTimezoneOffset(dialog, visibleInputs);
    } else {
      await fillByHints(
        dialog,
        [/person\s*id/i, /person\s*name/i, /employee/i, /select\s*user/i],
        input.personName,
        { enter: true },
      );
      await fillByHints(dialog, [/punch\s*date/i, /^date$/i], input.punchDate);
      await fillByHints(
        dialog,
        [/attendance\s*record/i, /punch\s*time/i, /^time$/i],
        input.punchTime.slice(0, 5),
      );
      await fillTimezoneOffset(dialog, dialog.locator("input:visible"));
    }
    await fillByHints(dialog, [/remarks?/i, /notes?/i], input.remarks, {
      textarea: true,
    }).catch(() => undefined);

    const submit = dialog
      .getByRole("button", { name: /^(ok|save|submit|confirm|add)$/i })
      .last();
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {}),
      submit.click({ timeout: 10_000 }),
    ]);
    await page.waitForTimeout(1_000);
    const errors = await page
      .locator(
        '[role="alert"], .Mui-error, .el-form-item__error, .ant-form-item-explain-error',
      )
      .allTextContents()
      .catch(() => []);
    const visibleErrors = errors.map((e) => e.trim()).filter(Boolean);
    const actionableErrors = visibleErrors.filter(
      (e) => !/^(success|successful|added successfully)$/i.test(e),
    );
    if (actionableErrors.length > 0) {
      if (
        actionableErrors.some((e) =>
          /already exists|duplicate cards|do not add duplicate/i.test(e),
        )
      ) {
        await ctx.close();
        return;
      }
      throw new Error(
        `NGTeco rejected the manual punch: ${actionableErrors.join(" | ")}`,
      );
    }

    const manualUrl = ngtecoUrl(
      input.portalUrl,
      sel.navigation.mendAttendancePunchUrl ?? "/att/timecard/manual-log",
    );
    await page.goto(manualUrl, { waitUntil: "domcontentloaded" });
    await page
      .getByText(/person\s*id/i)
      .first()
      .waitFor({ timeout: 15_000 });
    await waitForManualLogGridRefresh();
    if (!(await waitForExpectedManualRow())) {
      throw new Error(
        `NGTeco manual punch saved without expected timezone ${input.timeZoneOffset}; refusing to mark sync successful.`,
      );
    }

    await ctx.close();
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
      const candidateMs = new Date(
        `${candidate}-${m}-${d}T12:00:00Z`,
      ).getTime();
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
