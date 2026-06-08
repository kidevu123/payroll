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
    employeeRosterUrl?: string;
    attendanceReportUrl?: string;
    reportMenu?: string;
    attendanceMenu?: string;
    viewAttendancePunchLink?: string;
    mendAttendancePunchLink?: string;
    employeeRosterLink?: string;
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
  employeeRoster?: {
    tableLandmark: string;
    rowsContainer: string;
    personNameCell: string;
    personIdCell: string;
    emailCell: string;
    departmentCell: string;
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
  /** Raw date/time cells as scraped — for audit when disputing clock data. */
  rawDate?: string;
  rawTime?: string;
  rawTz?: string;
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

export type RawEmployeeRosterRow = {
  /** NGTeco Person ID from Group Management → Person. */
  personId: string;
  personName: string;
  email: string;
  department: string;
};

export type EmployeeRosterScrapeInput = {
  portalUrl: string;
  username: string;
  password: string;
  headless: boolean;
  runId: string;
};

export type EmployeeRosterScrapeOutput = {
  rows: RawEmployeeRosterRow[];
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

/** NGTeco's MUI login form mounts after domcontentloaded. URL-based
 *  detectLoginPage can return true while inputs are still absent. */
async function waitForLoginFormReady(
  page: import("playwright-core").Page,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>("input"),
      );
      return inputs.some((i) => {
        const box = i.getBoundingClientRect();
        const cs = getComputedStyle(i);
        const visible =
          box.width > 0 &&
          box.height > 0 &&
          cs.visibility !== "hidden" &&
          cs.display !== "none" &&
          cs.opacity !== "0";
        if (!visible) return false;
        const type = (i.type || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        const placeholder = (i.placeholder || "").toLowerCase();
        if (type === "password") return true;
        if (type === "email" || name === "username") return true;
        if (name.includes("user") || name.includes("email")) return true;
        return placeholder.includes("email");
      });
    },
    null,
    { timeout: 20_000 },
  );
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
  const emptyPage = inventory === "" || inventory === "(unable to read)";
  throw new ScrapeFailure(
    emptyPage
      ? `Could not locate a visible ${kind} field — the login form never appeared (page may still be loading or NGTeco changed the login UI). URL: ${page.url()}`
      : `Could not locate a visible ${kind} field that accepts our value. Inputs on page (• = visible, · = hidden): ${inventory}. NGTeco probably renamed the field; update lib/ngteco/scraper.ts fillLoginField with the new attributes shown above.`,
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
  if (!pathnameMatches(page, "/att/timecard/manual-log")) return false;
  try {
    const main = page.locator("main").last();
    if (
      await main
        .getByRole("button", { name: /^add$/i })
        .first()
        .isVisible()
    ) {
      return true;
    }
    return await page.locator(".MuiDataGrid-root").first().isVisible();
  } catch {
    return false;
  }
}

async function waitForMendPunchPageReady(page: PlaywrightPage): Promise<void> {
  await page.waitForFunction(
    () => window.location.pathname.includes("/att/timecard/manual-log"),
    null,
    { timeout: 15_000 },
  );
  const main = page.locator("main").last();
  const readyLocators: import("playwright-core").Locator[] = [
    main.getByRole("button", { name: /^add$/i }),
    page.getByPlaceholder(/search by person id/i),
    main.locator('[role="columnheader"]').filter({ hasText: /person id/i }),
    page.locator(".MuiDataGrid-root"),
  ];
  for (const loc of readyLocators) {
    try {
      if ((await loc.count()) === 0) continue;
      await loc.first().waitFor({ state: "visible", timeout: 6_000 });
      return;
    } catch {
      /* try next landmark */
    }
  }
  throw new ScrapeFailure(
    `NGTeco Mend Attendance Punch page did not become ready. URL=${page.url()}.`,
    {},
  );
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

async function isEmployeeRosterPageReady(
  page: PlaywrightPage,
  sel: Selectors,
): Promise<boolean> {
  if (!sel.employeeRoster) return false;
  if (pathnameMatches(page, "/hr/employee")) return true;
  return (await page.locator(sel.employeeRoster.tableLandmark).count()) > 0;
}

async function navigateToEmployeeRoster(
  page: PlaywrightPage,
  portalUrl: string,
  sel: Selectors,
): Promise<void> {
  assertNotOnLoginPage(page, "pre-employee-roster-navigation");

  if (sel.navigation.employeeRosterUrl) {
    await gotoNgtecoPath(page, portalUrl, sel.navigation.employeeRosterUrl);
    assertNotOnLoginPage(page, "employee-roster deep link");
    if (await isEmployeeRosterPageReady(page, sel)) return;
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
    /* proceed */
  }

  await expandSidebarSection(page, ["Group Management", "Group management"]);

  const clicked = await clickSidebarEntry(page, {
    ...(sel.navigation.employeeRosterLink
      ? { configuredSelector: sel.navigation.employeeRosterLink }
      : {}),
    textPatterns: [/^person$/i, /group.*person/i],
  });

  if (!clicked) {
    const sidebarLabels = await readSidebarLabels(page);
    throw new ScrapeFailure(
      `NGTeco navigation: could not reach Person roster. URL=${page.url()}. Sidebar labels seen: ${sidebarLabels}. Update lib/ngteco/selectors.json#navigation.employeeRosterUrl or employeeRosterLink.`,
      {},
    );
  }

  assertNotOnLoginPage(page, "post-employee-roster navigation");
  if (!(await isEmployeeRosterPageReady(page, sel))) {
    await page.waitForSelector(sel.employeeRoster!.tableLandmark, {
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
    try {
      await waitForMendPunchPageReady(page);
      return;
    } catch {
      /* fall through to sidebar navigation */
    }
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
  await waitForMendPunchPageReady(page);
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

/** Open the portal, handle challenges, and log in when needed. */
async function prepareNgtecoPage(
  page: PlaywrightPage,
  ctx: import("playwright-core").BrowserContext,
  input: { portalUrl: string; username: string; password: string },
  sel: Selectors,
): Promise<void> {
  await page.goto(input.portalUrl, { waitUntil: "domcontentloaded" });

  try {
    await page.waitForFunction(
      () => (document.body?.textContent ?? "").trim().length > 50,
      null,
      { timeout: 8_000 },
    );
  } catch {
    /* proceed; downstream selector probes will catch a still-blank page */
  }

  if ((await page.locator(sel.challenge.twoFactorLandmark).count()) > 0) {
    await ctx.close();
    throw new ChallengeDetectedError("TWO_FACTOR");
  }
  if ((await page.locator(sel.challenge.captchaLandmark).count()) > 0) {
    await ctx.close();
    throw new ChallengeDetectedError("CAPTCHA");
  }

  const onLoginPage = await detectLoginPage(page, sel);
  if (onLoginPage) {
    await waitForLoginFormReady(page);
    await fillLoginField(page, "username", sel.login.username, input.username);
    await fillLoginField(page, "password", sel.login.password, input.password);
    await ensureAgreementChecked(page);
    await primeIfCleared(page, "username", input.username);
    await primeIfCleared(page, "password", input.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
      clickLoginSubmit(page, sel.login.submit),
    ]);
    try {
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
      let helper = "";
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
    assertNotOnLoginPage(page, "post-login confirmation");
  } else {
    assertNotOnLoginPage(page, "initial page-load detection");
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
    await prepareNgtecoPage(page, ctx, input, sel);

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

    const discoveredCols = await discoverViewPunchColumns(page);
    const idSels = prependFieldSelector(
      splitSelectorList(sel.viewPunch.personIdCell),
      discoveredCols.personId,
    );
    const nameSels = prependFieldSelector(
      splitSelectorList(sel.viewPunch.personNameCell),
      discoveredCols.personName,
    );
    const dateSels = prependFieldSelector(
      splitSelectorList(sel.viewPunch.punchDateCell),
      discoveredCols.punchDate,
    );
    const timeSels = prependFieldSelector(
      [
        ...splitSelectorList(sel.viewPunch.punchTimeCell),
        '[role="cell"][data-field="att_time"]',
        '[role="cell"][data-field="punch_time"]',
        '[role="cell"][data-field="attendance_time"]',
      ],
      discoveredCols.punchTime,
    );
    const verifySels = prependFieldSelector(
      splitSelectorList(sel.viewPunch.verifyTypeCell),
      discoveredCols.verifyType,
    );
    const tzSels = prependFieldSelector(
      splitSelectorList(sel.viewPunch.timezoneCell),
      discoveredCols.timezone,
    );
    const sourceSels = prependFieldSelector(
      splitSelectorList(sel.viewPunch.sourceCell),
      discoveredCols.source,
    );

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
        nameSels,
        idSels,
        dateSels,
        timeSels,
        verifySels,
        tzSels,
        sourceSels,
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
          const pick = (row: Element, sels: string[]) => {
            for (const s of sels) {
              const text =
                (
                  row.querySelector(s) as HTMLElement | null
                )?.textContent?.trim() ?? "";
              if (text && !/^[—–-]$/.test(text)) return text;
            }
            return "";
          };
          const result: Array<Record<string, string>> = [];
          const rows = document.querySelectorAll(a.rowSel);
          for (const row of Array.from(rows)) {
            result.push({
              personName: pick(row, a.nameSels),
              personId: pick(row, a.idSels),
              dateRaw: pick(row, a.dateSels),
              timeRaw: pick(row, a.timeSels),
              verifyType: pick(row, a.verifySels),
              tzRaw: pick(row, a.tzSels),
              source: pick(row, a.sourceSels),
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
        if (!looksLikeWallClockTime(r.timeRaw)) continue;
        const punchAt = composeIso(r.dateRaw, r.timeRaw, r.tzRaw);
        if (!punchAt) continue;
        const key = `${r.personId}|${punchAt}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        events.push({
          personId: r.personId,
          personName: r.personName,
          punchAt,
          rawDate: r.dateRaw,
          rawTime: r.timeRaw,
          rawTz: r.tzRaw,
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

  const manualPunchTimePrefix = input.punchTime.slice(0, 5);

  const locateExpectedManualRow = () =>
    page
      .locator("tr, [role='row']")
      .filter({ hasText: input.personId })
      .filter({ hasText: input.punchDate })
      .filter({ hasText: manualPunchTimePrefix })
      .filter({ hasText: input.timeZoneOffset });

  const expectedManualRowVisible = async (): Promise<boolean> =>
    locateExpectedManualRow()
      .count()
      .then((count) => count > 0)
      .catch(() => false);

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

  const approveManualPunchIfNeeded = async (): Promise<void> => {
    const row = locateExpectedManualRow().first();
    if ((await row.count().catch(() => 0)) === 0) return;
    const text = await row.innerText().catch(() => "");
    if (/approved/i.test(text)) return;

    const checkbox = row.locator('input[type="checkbox"]').first();
    if ((await checkbox.count().catch(() => 0)) === 0) return;
    await checkbox.check({ timeout: 8_000 });
    const approvalButton = page.getByRole("button", { name: /^approval$/i });
    if ((await approvalButton.count().catch(() => 0)) === 0) return;
    await approvalButton.click({ timeout: 10_000 });
    await page.waitForTimeout(1_000);
    await waitForManualLogGridRefresh();
    const afterText = await row.innerText().catch(() => "");
    if (!/approved/i.test(afterText)) {
      throw new Error(
        `NGTeco manual punch saved but approval did not stick for ${input.personId} ${input.punchDate} ${manualPunchTimePrefix}.`,
      );
    }
  };

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
      await waitForLoginFormReady(page);
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
    await waitForMendPunchPageReady(page);
    await waitForManualLogGridRefresh();

    if (await expectedManualRowVisible()) {
      await approveManualPunchIfNeeded();
      await ctx.close();
      return;
    }

    const wrongTimezoneRows = page
      .locator("tr, [role='row']")
      .filter({ hasText: input.personId })
      .filter({ hasText: input.punchDate })
      .filter({ hasText: manualPunchTimePrefix });
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
      await personDrawer.waitFor({ state: "visible", timeout: 8_000 });
      const drawerSearch = personDrawer.locator("input:visible").first();
      await humanFill(drawerSearch, input.personId);
      await page.waitForTimeout(700);
      const idMatch = personDrawer.getByText(input.personId, { exact: true });
      if ((await idMatch.count().catch(() => 0)) > 0) {
        await idMatch.last().click({ timeout: 8_000 });
      } else {
        await humanFill(drawerSearch, input.personName);
        await page.waitForTimeout(700);
        await personDrawer
          .getByText(input.personName, { exact: false })
          .last()
          .click({
            timeout: 8_000,
          });
      }
      await personDrawer
        .getByText(/^confirm$/i)
        .last()
        .click({ timeout: 8_000 });
      await personDrawer
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => undefined);
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
    await waitForMendPunchPageReady(page);
    await waitForManualLogGridRefresh();
    if (!(await waitForExpectedManualRow())) {
      throw new Error(
        `NGTeco manual punch saved without expected timezone ${input.timeZoneOffset}; refusing to mark sync successful.`,
      );
    }
    await approveManualPunchIfNeeded();

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

function splitSelectorList(selector: string): string[] {
  return selector
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type DiscoveredViewPunchCols = {
  punchDate?: string;
  punchTime?: string;
  personId?: string;
  personName?: string;
  verifyType?: string;
  timezone?: string;
  source?: string;
};

/** Prefer the column whose header says "Time", not "Status" / check-in-out. */
async function discoverViewPunchColumns(
  page: PlaywrightPage,
): Promise<DiscoveredViewPunchCols> {
  return page.evaluate(() => {
    const fields: DiscoveredViewPunchCols = {};
    for (const h of Array.from(
      document.querySelectorAll('[role="columnheader"]'),
    )) {
      const field = h.getAttribute("data-field");
      const text = (h.textContent ?? "").trim().toLowerCase();
      if (!field) continue;
      if (
        /person\s*id|employee\s*(id|code)|\bperson\s*code\b/.test(text) &&
        !fields.personId
      ) {
        fields.personId = field;
      } else if (
        /person\s*name|employee\s*name|^name$/.test(text) &&
        !fields.personName
      ) {
        fields.personName = field;
      } else if (
        (/^date$|punch\s*date|att.*date/.test(text) ||
          field === "att_date") &&
        !fields.punchDate
      ) {
        fields.punchDate = field;
      } else if (
        (/^time$|punch\s*time|clock\s*time|attendance\s*time/.test(text) ||
          /^(att_time|punch_time|attendance_time)$/.test(field)) &&
        !/zone|format|status|state|verify/.test(text) &&
        !fields.punchTime
      ) {
        fields.punchTime = field;
      } else if (/verify|verification/.test(text) && !fields.verifyType) {
        fields.verifyType = field;
      } else if (
        (/time\s*zone|timezone|offset/.test(text) || field === "timezone") &&
        !fields.timezone
      ) {
        fields.timezone = field;
      } else if (
        (/source|punch\s*from|device/.test(text) || field === "punch_from") &&
        !fields.source
      ) {
        fields.source = field;
      }
    }
    return fields;
  });
}

function cellSelectorForField(field: string | undefined): string | null {
  return field ? `[role="cell"][data-field="${field}"]` : null;
}

function prependFieldSelector(
  list: string[],
  field: string | undefined,
): string[] {
  const sel = cellSelectorForField(field);
  if (sel && !list.includes(sel)) return [sel, ...list];
  return list;
}

/** NGTeco wall-clock cells are HH:MM or HH:MM:SS — not "Check In" labels. */
function looksLikeWallClockTime(raw: string): boolean {
  const t = raw.trim();
  if (!t || /check|clock\s*in|clock\s*out|^in$|^out$/i.test(t)) return false;
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(t);
}

/**
 * Scrape Group Management → Person (/hr/employee). Used to auto-import
 * new time-clock people into Milo as inactive stubs.
 */
export async function scrapeEmployeeRoster(
  input: EmployeeRosterScrapeInput,
): Promise<EmployeeRosterScrapeOutput> {
  const { mkdirSync, existsSync } = await import(
    /* webpackIgnore: true */ "node:fs"
  );
  const { join } = await import(/* webpackIgnore: true */ "node:path");
  const PROFILE_DIR = join(STORAGE_ROOT, "profile");
  const FAILURES_DIR = join(STORAGE_ROOT, "failures");
  const sel = await loadSelectors();
  if (!sel.employeeRoster) {
    throw new ScrapeFailure("selectors.employeeRoster not configured", {});
  }
  const t0 = Date.now();
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const failureDir = join(FAILURES_DIR, `${input.runId}-roster`);

  const { chromium } =
    (await import("playwright")) as typeof import("playwright");
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
    await prepareNgtecoPage(page, ctx, input, sel);
    await navigateToEmployeeRoster(page, input.portalUrl, sel);
    await page.waitForSelector(sel.employeeRoster.tableLandmark, {
      timeout: 15_000,
    });

    const rosterSel = sel.employeeRoster;
    let nameSels = splitSelectorList(rosterSel.personNameCell);
    let idSels = splitSelectorList(rosterSel.personIdCell);
    let emailSels = splitSelectorList(rosterSel.emailCell);
    let deptSels = splitSelectorList(rosterSel.departmentCell);

    const discovered = await page.evaluate(() => {
      const fields: {
        personId?: string;
        personName?: string;
        email?: string;
        department?: string;
      } = {};
      for (const h of Array.from(
        document.querySelectorAll('[role="columnheader"]'),
      )) {
        const field = h.getAttribute("data-field");
        const text = (h.textContent ?? "").trim().toLowerCase();
        if (!field) continue;
        if (
          /person\s*id|employee\s*(id|code)|\bid\b/.test(text) &&
          !fields.personId
        ) {
          fields.personId = field;
        } else if (/person\s*name|employee\s*name|name/.test(text) && !fields.personName) {
          fields.personName = field;
        } else if (/e-?mail/.test(text) && !fields.email) {
          fields.email = field;
        } else if (/department|dept/.test(text) && !fields.department) {
          fields.department = field;
        }
      }
      return fields;
    });
    const cellSel = (field: string | undefined) =>
      field ? `[role="cell"][data-field="${field}"]` : null;
    const prepend = (list: string[], field: string | undefined) => {
      const sel = cellSel(field);
      if (sel && !list.includes(sel)) list.unshift(sel);
    };
    prepend(idSels, discovered.personId);
    prepend(nameSels, discovered.personName);
    prepend(emailSels, discovered.email);
    prepend(deptSels, discovered.department);

    try {
      await page.waitForFunction(
        ({ rowSel, idSels }: { rowSel: string; idSels: string[] }) => {
          const pick = (row: Element, sels: string[]) => {
            for (const s of sels) {
              const el = row.querySelector(s);
              const text = el?.textContent?.trim() ?? "";
              if (text && !/^[—–-]$/.test(text)) return text;
            }
            return "";
          };
          const rows = document.querySelectorAll(rowSel);
          for (const row of Array.from(rows)) {
            if (pick(row, idSels)) return true;
          }
          return false;
        },
        { rowSel: rosterSel.rowsContainer, idSels },
        { timeout: 15_000 },
      );
    } catch {
      /* empty roster or slow hydrate */
    }

    type RowRaw = {
      personId: string;
      personName: string;
      email: string;
      department: string;
    };

    const rows: RawEmployeeRosterRow[] = [];
    const seenIds = new Set<string>();
    let pages = 0;

    while (pages < 50) {
      pages++;
      const collectVisible = async (): Promise<RowRaw[]> => {
        const out = await page.evaluate(
          (args: {
            rowSel: string;
            nameSels: string[];
            idSels: string[];
            emailSels: string[];
            deptSels: string[];
          }) => {
            const pick = (row: Element, sels: string[]) => {
              for (const s of sels) {
                const el = row.querySelector(s);
                const text = el?.textContent?.trim() ?? "";
                if (text && !/^[—–-]$/.test(text)) return text;
              }
              return "";
            };
            const pickName = (row: Element, sels: string[]) => {
              for (const s of sels) {
                const el = row.querySelector(s);
                if (!el) continue;
                const avatar = el.querySelector(
                  ".MuiAvatar-root, [class*='Avatar']",
                );
                let text = el.textContent?.trim() ?? "";
                if (avatar) {
                  const mark = avatar.textContent?.trim() ?? "";
                  if (
                    mark.length === 1 &&
                    text.toLowerCase().startsWith((mark + mark).toLowerCase())
                  ) {
                    text = text.slice(1).trim();
                  } else if (
                    mark.length === 1 &&
                    text.toLowerCase().startsWith(mark.toLowerCase())
                  ) {
                    const rest = text.slice(mark.length).trim();
                    if (rest) text = rest;
                  }
                }
                if (
                  text.length >= 2 &&
                  text[0]!.toLowerCase() === text[1]!.toLowerCase() &&
                  /[A-Za-z]/.test(text[0]!)
                ) {
                  text = text.slice(1).trim();
                }
                if (text && !/^[—–-]$/.test(text)) return text;
              }
              return "";
            };
            const result: RowRaw[] = [];
            for (const row of Array.from(
              document.querySelectorAll(args.rowSel),
            )) {
              const personId = pick(row, args.idSels);
              if (!personId) continue;
              result.push({
                personId,
                personName: pickName(row, args.nameSels),
                email: pick(row, args.emailSels),
                department: pick(row, args.deptSels),
              });
            }
            return result;
          },
          {
            rowSel: rosterSel.rowsContainer,
            nameSels,
            idSels,
            emailSels,
            deptSels,
          },
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

      await scrollStep(0);
      await page.waitForTimeout(150);
      let stableCount = 0;
      let lastSize = 0;
      for (let step = 0; step < 60; step++) {
        const visible = await collectVisible();
        for (const r of visible) {
          if (!r.personId) continue;
          if (pageKeys.has(r.personId)) continue;
          pageKeys.add(r.personId);
          pageRows.push(r);
        }
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
        if (stableCount >= 3) break;
      }
      await scrollStep(0);

      for (const r of pageRows) {
        if (seenIds.has(r.personId)) continue;
        seenIds.add(r.personId);
        rows.push(r);
      }

      const next = page.locator(rosterSel.nextPageButton).first();
      const hasNext =
        (await next.count()) > 0 && (await next.isEnabled().catch(() => false));
      if (!hasNext) break;
      await Promise.all([
        page.waitForTimeout(400),
        next.click().catch(() => {}),
      ]);
      try {
        await page.waitForFunction(
          ({ rowSel, idSels }: { rowSel: string; idSels: string[] }) => {
            const pick = (row: Element, sels: string[]) => {
              for (const s of sels) {
                const el = row.querySelector(s);
                const text = el?.textContent?.trim() ?? "";
                if (text && !/^[—–-]$/.test(text)) return text;
              }
              return "";
            };
            const rows = document.querySelectorAll(rowSel);
            for (const row of Array.from(rows)) {
              if (pick(row, idSels)) return true;
            }
            return false;
          },
          { rowSel: rosterSel.rowsContainer, idSels },
          { timeout: 8_000 },
        );
      } catch {
        break;
      }
    }

    await ctx.close();
    return { rows, durationMs: Date.now() - t0 };
  } catch (err) {
    if (err instanceof ChallengeDetectedError) throw err;
    if (err instanceof ScrapeFailure) throw err;
    return await captureFailure(
      err instanceof Error ? err.message : String(err),
    );
  }
}
