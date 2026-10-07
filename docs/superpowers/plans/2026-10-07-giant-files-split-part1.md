# Giant Files Split, Part 1 (harness, shared helpers, time page) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin what the three giant admin pages render, consolidate the duplicated date helpers into one tested module, and reduce `app/(admin)/time/page.tsx` from 1,663 lines to a fetch → `lib/` → components page, with the pinned output identical throughout.

**Architecture:** A golden-DOM harness (`scripts/golden/`) runs the built app against the local scratch database under a frozen clock and compares normalized HTML for a fixed route list. Pure logic moves to `lib/time/format.ts` and `lib/time-grid/*` with unit tests written first; the time page's JSX moves into `components/time/*` as props-in, markup-out components. Every step ends with `npm run golden:check` identical.

**Tech Stack:** Next.js 15 production build (`next build` + `next start`), Node 24, vitest, Postgres scratch DB `payroll_mobile_ui`.

**Spec:** `docs/superpowers/specs/2026-10-07-giant-files-split-design.md`. This plan implements spec steps 0, 1 and 2. Steps 3 (reports table) and 4 (period page) get their own plans after this one ships.

## Global Constraints

- No visual, wording or behaviour change. If `golden:check` differs, the step is wrong, not the golden. A golden is re-recorded only with the user's decision.
- `lib/ngteco/scraper.ts` and `lib/db/schema.ts` are not touched.
- `lib/payroll/**/*.ts` and `lib/punches/parser.ts` keep 100% coverage (`vitest.config.ts` thresholds). Anything placed under `lib/payroll/` needs full tests.
- Page files end under 300 lines; component files aim under 250.
- Pages do only: fetch, call `lib/`, render components. No cell-state or KPI maths in `page.tsx`.
- The job handlers (`lib/jobs/handlers/period-rollover.ts`, `payroll-run-tick.ts`) are changed last and in their own commit.
- Each task ends deployable. Push only when the user says so (a push auto-deploys). Deploy away from the top of the hour.
- No emoji anywhere.

## Review Focus

Inputs the spec implies but the tests below do not all exercise:

1. **A punch whose clock-in is before midnight company time and clock-out after** — expected: it counts on the clock-in day everywhere, exactly as today. Pinned by `cell-state.test.ts` "overnight punch stays on its clock-in day" (Task 4).
2. **An employee with a NULL pay schedule on a filtered tab** — expected: shown on every tab (wildcard rule). Pinned by the time page's `/time?schedule=weekly` golden (Task 1) plus `period-select.test.ts` does not cover it; it lives in the page's `employees` filter which is left in `page.tsx` by design.
3. **A period whose stored end date is shorter than 7 days** — expected: the grid still shows Monday→Sunday (`canonicalEnd` rule). Pinned by `kpis.test.ts` "days span is widened to seven" (Task 5) via `gridDays`.
4. **Today falls inside a LOCKED period (owner locked early)** — expected: the page shows that locked period, not a synthetic next window (`mostRecent.endDate >= today` rule). Pinned by `period-select.test.ts` "a locked period that still covers today is used" (Task 3).
5. **The frozen clock leaking into a real deploy** — expected: never; `fixed-clock.cjs` is loaded only via `NODE_OPTIONS` set by the harness, never by the Dockerfile. Pinned by Task 1's `grep -c fixed-clock Dockerfile package.json` = 0 check.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scripts/golden/fixed-clock.cjs` | create | freeze `Date` for the harnessed server |
| `scripts/golden/run.mjs` | create | start server, log in, fetch routes, normalize, record or check |
| `scripts/golden/README.md` | create | how to run; the scratch-DB SQL that sets up page states |
| `tests/golden/<role>/<label>.html` | create (recorded) | the pins |
| `package.json` | modify | `golden:record`, `golden:check` scripts |
| `lib/time/format.ts` + `.test.ts` | create | `todayInCompanyTz`, `eachDayIso`, `utcDayIso`, `formatClockTime` |
| `lib/time-grid/period-select.ts` + `.test.ts` | create | pure period-selection rules |
| `lib/db/queries/time-grid.ts` | create | DB side of period selection (moved verbatim from the page) |
| `lib/time-grid/cell-state.ts` + `.test.ts` | create | cell state rules, labels, classes |
| `lib/time-grid/kpis.ts` + `.test.ts` | create | grid figures |
| `components/time/*.tsx` | create | day strip, attendance list, punch cell, KPI cards, legend, rail cards |
| `app/(admin)/time/page.tsx` | modify | shrinks to fetch → lib → components |
| 7 caller files of the date helpers | modify | import from `lib/time/format` |
| `CLAUDE.md` | modify | briefing entry |

---

### Task 1: Golden harness and recorded pins

**Files:**
- Create: `scripts/golden/fixed-clock.cjs`, `scripts/golden/run.mjs`, `scripts/golden/README.md`
- Create: `.env.golden.local` (git-ignored by the existing `.env.*.local` rule; never committed)
- Modify: `package.json` (scripts)
- Create: `tests/golden/**` (recorded output, committed)

**Interfaces:**
- Produces: `npm run golden:record` and `npm run golden:check` (exit 0 identical, exit 1 with a diff otherwise). Every later task runs `golden:check` as its last gate.

- [ ] **Step 1: Prepare the scratch database states**

The scratch DB exists from the mobile pass (24 employees, 6 periods, logins `owner@example.com` / `marcus@example.com`, password `Passw0rd!demo`). It has no payroll runs or payslips. Start the app against it and publish the most recent LOCKED weekly period through the UI, then set the remaining states by SQL.

```bash
cat > .env.golden.local <<'EOF'
DATABASE_URL=postgresql://localhost:5432/payroll_mobile_ui
AUTH_SECRET=golden-only-secret-golden-only-secret-golden-only
NGTECO_VAULT_KEY=Z29sZGVuLW9ubHktdmF1bHQta2V5LTMyLWJ5dGVzISE=
APP_URL=http://localhost:3111
AUTH_URL=http://localhost:3111
AUTH_TRUST_HOST=true
STORAGE_ROOT=/tmp/payroll-golden-storage
NODE_ENV=production
EOF
mkdir -p /tmp/payroll-golden-storage
```

(`NGTECO_VAULT_KEY` must be 32 bytes base64; the value above is. Nothing sealed with it exists in the scratch DB.)

Build and start once by hand to publish:

```bash
npx next build
set -a; . ./.env.golden.local; set +a; npx next start -p 3111 &
```

In a browser at `http://localhost:3111`: sign in as the owner, open Payroll, open the most recent locked period (Sep 28 – Oct 04, 2026), press **Publish**, wait ~20 s. Then:

```bash
psql -d payroll_mobile_ui -Atc "select count(*), count(pdf_path) from payslips"   # expect 22|22
```

Then the SQL states (also recorded in `scripts/golden/README.md`):

```bash
psql -d payroll_mobile_ui <<'SQL'
-- one period paid by cash (the second most recent locked weekly period)
update pay_periods set state='PAID', payment_method='CASH', paid_at='2026-10-05T14:00:00Z'
 where id = (select id from pay_periods where state='LOCKED' and start_date='2026-09-21');
-- one acknowledged payslip and one disputed one on the published period
update payslips set acknowledged_at='2026-10-06T12:00:00Z'
 where id = (select id from payslips order by employee_id limit 1);
update payslips set dispute_reason='golden: wrong hours', disputed_at='2026-10-06T12:30:00Z'
 where id = (select id from payslips order by employee_id offset 1 limit 1);
SQL
kill %1
```

If the `payslips` columns are named differently (`disputed_at` / `dispute_reason`), read `lib/db/schema.ts` `payslips` and use the real names; the state needed is "one acknowledged, one disputed".

- [ ] **Step 2: Write the frozen clock**

`scripts/golden/fixed-clock.cjs`:

```js
// Loaded via NODE_OPTIONS=--require by scripts/golden/run.mjs ONLY. Freezes
// "now" so goldens do not drift: the demo data is relative to the day it was
// seeded. `new Date(value)` and Date.parse are untouched.
const fixed = Date.parse(process.env.GOLDEN_NOW ?? "");
if (Number.isNaN(fixed)) throw new Error("GOLDEN_NOW must be an ISO instant");
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(fixed);
    else super(...args);
  }
  static now() {
    return fixed;
  }
}
globalThis.Date = FixedDate;
```

- [ ] **Step 3: Write the harness**

`scripts/golden/run.mjs`:

```js
// usage: node scripts/golden/run.mjs record|check
// Starts the BUILT app (run `npx next build` first) on :3111 against
// .env.golden.local under a frozen clock, fetches each route as the owner and
// the employee, normalizes the HTML and records or compares tests/golden/.
import { spawn, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mode = process.argv[2];
if (mode !== "record" && mode !== "check") { console.error("usage: run.mjs record|check"); process.exit(2); }
config({ path: join(ROOT, ".env.golden.local") });
const BASE = "http://localhost:3111";
const GOLDEN_NOW = "2026-10-06T18:00:00Z";
const OUT = join(ROOT, "tests", "golden");

// Ids resolved from the scratch DB so filenames stay stable.
const q = (sql) => execSync(`psql -d payroll_mobile_ui -Atc "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const lockedWeekly = q("select id from pay_periods where start_date='2026-09-28'");
const openWeekly = q("select id from pay_periods where state='OPEN' and end_date-start_date=6 order by start_date desc limit 1");
const monthly = q("select id from pay_periods where end_date-start_date>20 order by start_date desc limit 1");
const paidCash = q("select id from pay_periods where payment_method='CASH' limit 1");

const ROUTES = [
  ["owner", "time", "/time"],
  ["owner", "time-weekly", "/time?schedule=weekly"],
  ["owner", "time-monthly", "/time?schedule=monthly"],
  ["owner", "time-salaried", "/time?schedule=salaried"],
  ["owner", "time-day", "/time?day=2026-10-05"],
  ["owner", "time-locked-period", `/time?period=${lockedWeekly}`],
  ["owner", "reports", "/reports"],
  ["owner", "reports-2026", "/reports?year=2026"],
  ["owner", "reports-2025", "/reports?year=2025"],
  ["owner", "reports-employees", "/reports?tab=employees"],
  ["owner", "reports-schedules", "/reports?tab=schedules"],
  ["owner", "reports-methods", "/reports?tab=methods"],
  ["owner", "reports-weekly", "/reports?schedule=weekly"],
  ["owner", "reports-monthly", "/reports?schedule=monthly"],
  ["owner", "payroll", "/payroll"],
  ["owner", "payroll-locked-weekly", `/payroll/${lockedWeekly}`],
  ["owner", "payroll-open-weekly", `/payroll/${openWeekly}`],
  ["owner", "payroll-monthly", `/payroll/${monthly}`],
  ["owner", "payroll-paid-cash", `/payroll/${paidCash}`],
  ["employee", "me-home", "/me/home"],
  ["employee", "me-time", "/me/time"],
  ["employee", "me-pay", "/me/pay"],
];

function normalize(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/\/_next\/static\/[^/"']+\//g, "/_next/static/HASH/")
    .replace(/-[a-f0-9]{16}\.(js|css)/g, "-HASH.$1")
    .replace(/commit\/[a-f0-9]{7,40}/g, "commit/SHA")
    .replace(/>[a-f0-9]{7}</g, ">SHA<")
    .replace(/Server time [^<]+/g, "Server time TIME");
}

class Jar {
  constructor() { this.c = new Map(); }
  take(res) { for (const line of res.headers.getSetCookie?.() ?? []) { const [kv] = line.split(";"); const [k, v] = kv.split("="); this.c.set(k.trim(), v); } }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function login(email) {
  const jar = new Jar();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`); jar.take(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, email, password: "Passw0rd!demo", callbackUrl: `${BASE}/` });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", body, redirect: "manual", headers: { cookie: jar.header(), "content-type": "application/x-www-form-urlencoded" } });
  jar.take(res);
  if (![302, 303, 200].includes(res.status)) throw new Error(`login ${email}: HTTP ${res.status}`);
  return jar;
}
async function get(jar, path) {
  const res = await fetch(BASE + path, { headers: { cookie: jar.header() }, redirect: "manual" });
  if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status}`);
  return normalize(await res.text());
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server never became healthy");
}

const server = spawn("npx", ["next", "start", "-p", "3111"], {
  cwd: ROOT, stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, TZ: "UTC", GOLDEN_NOW, NODE_OPTIONS: `--require ${join(ROOT, "scripts/golden/fixed-clock.cjs")}` },
});
let failures = 0;
try {
  await waitHealthy();
  const jars = { owner: await login("owner@example.com"), employee: await login("marcus@example.com") };
  for (const [role, label, path] of ROUTES) {
    const html = await get(jars[role], path);
    const file = join(OUT, role, `${label}.html`);
    mkdirSync(dirname(file), { recursive: true });
    if (mode === "record") { writeFileSync(file, html); console.log(`recorded ${role}/${label}`); continue; }
    if (!existsSync(file)) { console.log(`MISSING ${role}/${label}`); failures++; continue; }
    const want = readFileSync(file, "utf8");
    if (want === html) { console.log(`same     ${role}/${label}`); continue; }
    failures++;
    const tmp = join(OUT, role, `${label}.actual.html`); writeFileSync(tmp, html);
    console.log(`DIFF     ${role}/${label}`);
    try { execSync(`diff -u "${file}" "${tmp}" | head -40`, { stdio: "inherit" }); } catch {}
  }
} finally {
  server.kill("SIGTERM");
}
if (mode === "check") { console.log(failures ? `\n${failures} ROUTE(S) DIFFER` : "\nALL GOLDENS IDENTICAL"); process.exit(failures ? 1 : 0); }
```

Add to `package.json` scripts:

```json
"golden:record": "node scripts/golden/run.mjs record",
"golden:check": "node scripts/golden/run.mjs check"
```

- [ ] **Step 4: Write the README**

`scripts/golden/README.md`: the purpose (one paragraph), the exact `.env.golden.local` contents from Step 1 (secrets are throwaway), the publish-by-hand step and the SQL block from Step 1 verbatim, `npx next build` before either script, and the rule: a golden changes only with the user's decision.

- [ ] **Step 5: Record, then prove the harness detects a change (RED), then restore (GREEN)**

```bash
npx next build && npm run golden:record 2>&1 | tail -3
npm run golden:check 2>&1 | tail -2            # expect: ALL GOLDENS IDENTICAL
ls tests/golden/owner | wc -l                  # expect 19
# RED: a one-character visible change must be caught
sed -i '' 's/>Time</>Tlme</' "app/(admin)/time/page.tsx" && npx next build >/dev/null && npm run golden:check 2>&1 | grep -E "DIFF|IDENTICAL|DIFFER" | head -3
# expect: DIFF owner/time (and the other /time routes), "N ROUTE(S) DIFFER"
git checkout "app/(admin)/time/page.tsx" && rm -f tests/golden/*/*.actual.html && npx next build >/dev/null && npm run golden:check 2>&1 | tail -1
# expect: ALL GOLDENS IDENTICAL
grep -c "fixed-clock" Dockerfile package.json   # expect 0 and 0 apart from the two npm scripts' own lines: run `grep -n fixed-clock Dockerfile` -> no output
```

If `golden:record` fails on a route with HTTP 500, that page has a branch the scratch data breaks; read the server log, fix the data by SQL (add the statement to the README), re-record.

- [ ] **Step 6: Commit**

```bash
echo "tests/golden/**/*.actual.html" >> .gitignore
git add scripts/golden package.json .gitignore tests/golden
git commit -m "test(golden): pin the rendered DOM of the time, reports, period and employee pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `lib/time/format.ts` — one home for the duplicated date helpers

**Files:**
- Create: `lib/time/format.ts`, `lib/time/format.test.ts`
- Modify: `app/(employee)/me/time/page.tsx`, `app/(employee)/me/pay/[periodId]/page.tsx`, `app/(employee)/me/time/[date]/page.tsx` (`fmtTime` → `formatClockTime`), `lib/payroll/detect-exceptions.ts` and `lib/payroll/period-boundaries.ts` (`formatDay` → `utcDayIso`, `eachDay` → `eachDayIso`), `app/(admin)/time/page.tsx` (`todayInTimezone` → `todayInCompanyTz`, `eachDay` → `eachDayIso`), `lib/punches/poll-importer.ts` (`dayKey` → `companyDayIso`), `app/(admin)/punches/page.tsx` and `app/(employee)/me/time/page.tsx` (`dayKey` wrappers → `companyDayIso` directly)
- Last, own commit: `lib/jobs/handlers/period-rollover.ts`, `lib/jobs/handlers/payroll-run-tick.ts`

Not touched, on purpose: `lib/pdf/admin-report.tsx` `fmtTime` (formats an `HH:MM` string, a different job), `components/domain/punch-row.tsx` `formatDay` (a display formatter, different job), `lib/payroll/computePay.ts` `dayKey` (has a UTC fallback for fixtures; under the 100% gate; leave), `app/(employee)/me/calendar/page.tsx` `dayKey` (uses the HOST timezone, not the company's — a latent bug; changing it is a behaviour change, so it is pinned as-is by the `me-home`/`me-time` goldens and flagged in `CLAUDE.md`, not fixed here).

**Interfaces:**
- Produces:
  - `todayInCompanyTz(tz: string, now?: Date): string` → `YYYY-MM-DD`
  - `eachDayIso(startIso: string, endIso: string): string[]` inclusive
  - `utcDayIso(d: Date): string` → `YYYY-MM-DD` from UTC fields
  - `formatClockTime(d: Date | null, tz: string, locale: string): string` → locale `h:mm a` or `"—"`

- [ ] **Step 1: Write the failing tests**

`lib/time/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { todayInCompanyTz, eachDayIso, utcDayIso, formatClockTime } from "./format";
import { companyDayIso } from "./company-day";

describe("todayInCompanyTz", () => {
  // The three former copies used Intl en-CA with only timeZone set. The
  // consolidated version must give the same key as companyDayIso.
  it("matches the en-CA incantation the copies used, either side of midnight ET", () => {
    for (const iso of ["2026-10-06T03:59:00Z", "2026-10-06T04:00:00Z", "2026-03-08T06:59:00Z", "2026-03-08T07:00:00Z"]) {
      const now = new Date(iso);
      const legacy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
      expect(todayInCompanyTz("America/New_York", now)).toBe(legacy);
      expect(todayInCompanyTz("America/New_York", now)).toBe(companyDayIso(now, "America/New_York"));
    }
  });
  it("defaults to the current instant", () => {
    expect(todayInCompanyTz("UTC")).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("eachDayIso", () => {
  it("is inclusive and crosses a month end", () => {
    expect(eachDayIso("2026-09-28", "2026-10-04")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });
  it("returns one day when start equals end, none when reversed", () => {
    expect(eachDayIso("2026-10-05", "2026-10-05")).toEqual(["2026-10-05"]);
    expect(eachDayIso("2026-10-06", "2026-10-05")).toEqual([]);
  });
  it("is unaffected by a DST change inside the range", () => {
    expect(eachDayIso("2026-03-07", "2026-03-09")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });
});

describe("utcDayIso", () => {
  it("formats from UTC fields with zero padding", () => {
    expect(utcDayIso(new Date("2026-01-05T23:59:59Z"))).toBe("2026-01-05");
    expect(utcDayIso(new Date("2026-10-06T00:00:00Z"))).toBe("2026-10-06");
  });
});

describe("formatClockTime", () => {
  it("renders the employee pages' format in en-US and es-MX", () => {
    const d = new Date("2026-10-06T13:05:00Z"); // 9:05 AM ET
    expect(formatClockTime(d, "America/New_York", "en-US")).toBe("9:05 AM");
    expect(formatClockTime(d, "America/New_York", "es-MX")).toMatch(/9:05/);
  });
  it("renders an em dash for null", () => {
    expect(formatClockTime(null, "America/New_York", "en-US")).toBe("—");
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run lib/time/format.test.ts`
Expected: FAIL, "Failed to resolve import ./format".

- [ ] **Step 3: Implement**

`lib/time/format.ts`:

```ts
// Date and day helpers that used to exist as private copies in five+ files
// (time page, two payroll job handlers, three employee pages, two payroll
// modules). One implementation, tested; callers import from here.
import { companyDayIso } from "./company-day";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for the current instant in the company timezone. */
export function todayInCompanyTz(tz: string, now: Date = new Date()): string {
  return companyDayIso(now, tz);
}

/** Every calendar day from startIso to endIso inclusive, as "YYYY-MM-DD". */
export function eachDayIso(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** "YYYY-MM-DD" from a Date's UTC fields (period-boundary arithmetic). */
export function utcDayIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${d.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Locale clock time ("9:05 AM" / "9:05 a. m.") in the company zone; em dash for null. */
export function formatClockTime(d: Date | null, tz: string, locale: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run lib/time/format.test.ts`
Expected: PASS 8/8.

- [ ] **Step 5: Swap the page and `lib/payroll` callers (not the job handlers)**

In each file, delete the private function and import the replacement; keep call sites' arguments unchanged:

- `app/(employee)/me/time/page.tsx`, `me/pay/[periodId]/page.tsx`, `me/time/[date]/page.tsx`: delete `function fmtTime(...)`; add `import { formatClockTime } from "@/lib/time/format";`; rename each `fmtTime(` call to `formatClockTime(`. In `me/time/page.tsx` also delete `function dayKey(d, tz)` and replace `dayKey(` calls with `companyDayIso(` (already imported there).
- `app/(admin)/punches/page.tsx`: same `dayKey` → `companyDayIso` swap.
- `lib/punches/poll-importer.ts`: delete `function dayKey(iso, tz)`; replace `dayKey(x, tz)` with `companyDayIso(new Date(x), tz)`; import `companyDayIso` from `@/lib/time/company-day`.
- `lib/payroll/detect-exceptions.ts`: delete `eachDay` and `formatDay`; import `{ eachDayIso, utcDayIso }` from `@/lib/time/format`; `eachDay(` → `eachDayIso(`, `formatDay(` → `utcDayIso(`.
- `lib/payroll/period-boundaries.ts`: delete `formatDay`; import `{ utcDayIso }`; `formatDay(` → `utcDayIso(`.
- `app/(admin)/time/page.tsx`: delete `todayInTimezone`, `eachDay`, `MS_PER_DAY` if now unused; import `{ todayInCompanyTz, eachDayIso }`; swap calls.

Then:

```bash
npm run typecheck && npx vitest run --coverage 2>&1 | grep -E "Tests |ERROR|threshold" ; npx next build >/dev/null && npm run golden:check 2>&1 | tail -1
```

Expected: typecheck clean; all tests pass with no threshold error (`lib/payroll` coverage stays 100%: `utcDayIso`/`eachDayIso` are in `lib/time`, which has no threshold but is included in coverage); `ALL GOLDENS IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add lib/time/format.ts lib/time/format.test.ts app lib/payroll lib/punches
git commit -m "refactor(time): one tested home for the duplicated date helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: The job handlers, in their own commit**

`lib/jobs/handlers/period-rollover.ts` and `payroll-run-tick.ts`: delete the private `todayInTimezone`, import `{ todayInCompanyTz }` from `@/lib/time/format`, replace the one call in each. These decide when payroll runs; the test in Step 1 proves the key is identical for instants either side of midnight ET and across a DST change.

```bash
npm run typecheck && npx vitest run 2>&1 | grep "Tests " && git add lib/jobs/handlers && git commit -m "refactor(jobs): payroll tick and rollover use todayInCompanyTz

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `lib/time-grid/period-select.ts` (pure rules) + `lib/db/queries/time-grid.ts` (the queries)

**Files:**
- Create: `lib/time-grid/period-select.ts`, `lib/time-grid/period-select.test.ts`, `lib/db/queries/time-grid.ts`
- Modify: `app/(admin)/time/page.tsx` (delete `PeriodView` type, `ensureCadencePeriodForToday`, `pickPeriodForTab`, `nextWindowAfter`, `findAdjacentPeriods`; import them)

**Interfaces:**
- Produces (pure, `lib/time-grid/period-select.ts`):
  - `type PeriodKind = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY"`
  - `type PeriodView = { id: string; startDate: string; endDate: string; payScheduleId: string | null; state: "OPEN" | "LOCKED" | "PAID" | "UPCOMING" }`
  - `nextWindowAfter(prevEnd: string, kind: PeriodKind): { start: string; end: string }`
  - `resolveFromMostRecent(mostRecent: { id; startDate; endDate; payScheduleId; state: "OPEN"|"LOCKED"|"PAID"; kind: PeriodKind | null }, today: string, kindFilter: PeriodKind | null): PeriodView`
  - `gridLastDay(period: Pick<PeriodView, "startDate" | "endDate">): string` (the canonical Mon→Sun widening)
- Produces (DB, `lib/db/queries/time-grid.ts`): `pickPeriodForTab(kind, today)`, `findAdjacentPeriods(period)`, `ensureCadencePeriodForToday(kind, today)`, `loadPeriodById(id)` — bodies moved verbatim from the page, with the pure parts replaced by calls.

- [ ] **Step 1: Write the failing tests**

`lib/time-grid/period-select.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextWindowAfter, resolveFromMostRecent, gridLastDay } from "./period-select";

describe("nextWindowAfter", () => {
  it("weekly: the 7 days after the previous end", () => {
    expect(nextWindowAfter("2026-10-04", "WEEKLY")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });
  it("biweekly: 14 days", () => {
    expect(nextWindowAfter("2026-10-04", "BIWEEKLY")).toEqual({ start: "2026-10-05", end: "2026-10-18" });
  });
  it("monthly and semi-monthly: the next full calendar month, across a year end", () => {
    expect(nextWindowAfter("2026-11-30", "MONTHLY")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(nextWindowAfter("2026-12-31", "SEMI_MONTHLY")).toEqual({ start: "2027-01-01", end: "2027-01-31" });
  });
});

const base = { id: "p1", startDate: "2026-09-28", endDate: "2026-10-04", payScheduleId: "s1" };

describe("resolveFromMostRecent", () => {
  it("an OPEN period is used as-is", () => {
    expect(resolveFromMostRecent({ ...base, state: "OPEN", kind: "WEEKLY" }, "2026-10-06", "WEEKLY")).toMatchObject({ id: "p1", state: "OPEN" });
  });
  it("a locked period that still covers today is used", () => {
    expect(resolveFromMostRecent({ ...base, state: "LOCKED", kind: "WEEKLY" }, "2026-10-04", "WEEKLY")).toMatchObject({ id: "p1", state: "LOCKED" });
  });
  it("a locked period that ended rolls forward to a synthetic next window", () => {
    expect(resolveFromMostRecent({ ...base, state: "PAID", kind: "WEEKLY" }, "2026-10-06", "WEEKLY")).toEqual({ id: "", startDate: "2026-10-05", endDate: "2026-10-11", payScheduleId: "s1", state: "UPCOMING" });
  });
  it("with no tab filter the period's own kind drives the roll, defaulting to weekly", () => {
    expect(resolveFromMostRecent({ ...base, state: "PAID", kind: "MONTHLY" }, "2026-10-06", null).endDate).toBe("2026-11-30");
    expect(resolveFromMostRecent({ ...base, state: "PAID", kind: null }, "2026-10-06", null).endDate).toBe("2026-10-11");
  });
});

describe("gridLastDay", () => {
  it("widens a short stored range to a full seven days", () => {
    expect(gridLastDay({ startDate: "2026-10-05", endDate: "2026-10-09" })).toBe("2026-10-11");
  });
  it("keeps a range that is already seven days or longer", () => {
    expect(gridLastDay({ startDate: "2026-10-01", endDate: "2026-10-31" })).toBe("2026-10-31");
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run lib/time-grid/period-select.test.ts`
Expected: FAIL, cannot resolve `./period-select`.

- [ ] **Step 3: Implement the pure module**

`lib/time-grid/period-select.ts`:

```ts
// Which pay period the /time grid shows, as pure rules. The database side
// (lib/db/queries/time-grid.ts) finds candidate rows; these functions decide.
export type PeriodKind = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";

export type PeriodView = {
  /** Real DB id, or "" for a synthetic forward-rolled window. */
  id: string;
  startDate: string;
  endDate: string;
  payScheduleId: string | null;
  /** Display-only label about the period's underlying state. */
  state: "OPEN" | "LOCKED" | "PAID" | "UPCOMING";
};

/**
 * The window that immediately follows `prevEnd` for a cadence: the next 7
 * (or 14) days for weekly/biweekly, the next full calendar month otherwise.
 */
export function nextWindowAfter(prevEnd: string, kind: PeriodKind): { start: string; end: string } {
  const startDate = new Date(`${prevEnd}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  if (kind === "WEEKLY" || kind === "BIWEEKLY") {
    const end = new Date(startDate);
    end.setUTCDate(end.getUTCDate() + (kind === "WEEKLY" ? 6 : 13));
    return { start: startDate.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const start = new Date(startDate);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() + 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Owner's mental model: "if last week is locked, move on". A most-recent
 * period that is OPEN, or that still covers today, is shown; otherwise the
 * grid rolls forward to the next synthetic window (id "") so the admin sees
 * the live week instead of the closed one.
 */
export function resolveFromMostRecent(
  mostRecent: { id: string; startDate: string; endDate: string; payScheduleId: string | null; state: "OPEN" | "LOCKED" | "PAID"; kind: PeriodKind | null },
  today: string,
  kindFilter: PeriodKind | null,
): PeriodView {
  if (mostRecent.state === "OPEN" || mostRecent.endDate >= today) {
    return { id: mostRecent.id, startDate: mostRecent.startDate, endDate: mostRecent.endDate, payScheduleId: mostRecent.payScheduleId, state: mostRecent.state };
  }
  const next = nextWindowAfter(mostRecent.endDate, kindFilter ?? mostRecent.kind ?? "WEEKLY");
  return { id: "", startDate: next.start, endDate: next.end, payScheduleId: mostRecent.payScheduleId, state: "UPCOMING" };
}

/**
 * The grid always renders a full Monday->Sunday week even when the stored
 * period is shorter (the owner sometimes pulls punches early).
 */
export function gridLastDay(period: { startDate: string; endDate: string }): string {
  const start = new Date(`${period.startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 6);
  const canonicalEnd = start.toISOString().slice(0, 10);
  return period.endDate < canonicalEnd ? canonicalEnd : period.endDate;
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run lib/time-grid/period-select.test.ts`
Expected: PASS 9/9.

- [ ] **Step 5: Move the queries**

Create `lib/db/queries/time-grid.ts` by moving, verbatim, from `app/(admin)/time/page.tsx`: `ensureCadencePeriodForToday`, `pickPeriodForTab`, `findAdjacentPeriods`, and the `?period=` lookup block (as `loadPeriodById(id: string)` returning `{ ...row, kind }` or `null`). Inside `pickPeriodForTab`, replace the trailing "if mostRecent is OPEN or covers today … else nextWindowAfter" block with `return resolveFromMostRecent(mostRecent, today, kind)`. Imports: `db`, `payPeriods`, `paySchedules`, drizzle operators, `ensurePeriodForSchedule`, and the types from `lib/time-grid/period-select`. Export all four. In the page: delete the moved code and the `PeriodView` type, import `{ pickPeriodForTab, findAdjacentPeriods, loadPeriodById }` and `{ type PeriodView, gridLastDay }`, and replace the inline `canonicalEnd`/`lastDay` block with `const lastDay = gridLastDay(period);`.

```bash
npm run typecheck && npx vitest run 2>&1 | grep "Tests " && npx next build >/dev/null && npm run golden:check 2>&1 | tail -1
```

Expected: clean; `ALL GOLDENS IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add lib/time-grid lib/db/queries/time-grid.ts "app/(admin)/time/page.tsx"
git commit -m "refactor(time): period selection rules in lib/time-grid, queries in lib/db

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `lib/time-grid/cell-state.ts`

**Files:**
- Create: `lib/time-grid/cell-state.ts`, `lib/time-grid/cell-state.test.ts`
- Modify: `app/(admin)/time/page.tsx` (delete `CellState`, `cellPillClasses`, `legendDotClass`, `MOBILE_STATUS`, `timeInitials`, `timeOffStateFor`, `timeOffLabel`, `cellFor`, `cellAriaLabel`; import)

**Interfaces:**
- Produces:
  - `type CellState = "complete" | "incomplete" | "missed" | "future" | "inactive" | "pto" | "sick" | "unpaid" | "other"`
  - `type TimeOffType = "UNPAID" | "SICK" | "PERSONAL" | "OTHER"`
  - `type PunchLite = { clockIn: Date; clockOut: Date | null }` (the page's punch rows satisfy it)
  - `cellStateFor(args: { punches: PunchLite[]; offType: TimeOffType | undefined; dayIso: string; today: string; employeeActive: boolean }): CellState`
  - `summarizeCell(punches: PunchLite[]): { sorted: PunchLite[]; closedMs: number }`
  - `timeOffStateFor(t: TimeOffType): CellState`, `timeOffLabel(s: CellState): string`, `cellPillClasses(s)`, `legendDotClass(s)`, `MOBILE_STATUS`, `timeInitials(name)`, `cellAriaLabel(state, list, tz)`

- [ ] **Step 1: Write the failing tests**

`lib/time-grid/cell-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cellStateFor, summarizeCell, timeOffStateFor, timeOffLabel, timeInitials, cellAriaLabel } from "./cell-state";

const at = (s: string) => new Date(s);
const complete = [{ clockIn: at("2026-10-05T13:00:00Z"), clockOut: at("2026-10-05T21:00:00Z") }];
const open = [{ clockIn: at("2026-10-05T13:00:00Z"), clockOut: null }];
const common = { dayIso: "2026-10-05", today: "2026-10-06", employeeActive: true, offType: undefined };

describe("cellStateFor", () => {
  it("complete when every punch is paired", () => {
    expect(cellStateFor({ ...common, punches: complete })).toBe("complete");
  });
  it("incomplete when a punch is still open", () => {
    expect(cellStateFor({ ...common, punches: open })).toBe("incomplete");
  });
  it("missed for a past day with no punches", () => {
    expect(cellStateFor({ ...common, punches: [] })).toBe("missed");
  });
  it("future, not missed, for a day after today", () => {
    expect(cellStateFor({ ...common, punches: [], dayIso: "2026-10-09" })).toBe("future");
  });
  it("time off beats missed, and maps each type", () => {
    expect(cellStateFor({ ...common, punches: [], offType: "PERSONAL" })).toBe("pto");
    expect(cellStateFor({ ...common, punches: [], offType: "SICK" })).toBe("sick");
    expect(cellStateFor({ ...common, punches: [], offType: "UNPAID" })).toBe("unpaid");
    expect(cellStateFor({ ...common, punches: [], offType: "OTHER" })).toBe("other");
  });
  it("punches beat time off (the day was worked after all)", () => {
    expect(cellStateFor({ ...common, punches: complete, offType: "SICK" })).toBe("complete");
  });
  it("inactive beats everything", () => {
    expect(cellStateFor({ ...common, punches: complete, employeeActive: false })).toBe("inactive");
  });
  it("overnight punch stays on its clock-in day", () => {
    const overnight = [{ clockIn: at("2026-10-05T22:00:00Z"), clockOut: at("2026-10-06T06:00:00Z") }];
    expect(cellStateFor({ ...common, punches: overnight })).toBe("complete");
  });
});

describe("summarizeCell", () => {
  it("sorts by clock-in and sums only closed punches", () => {
    const list = [open[0]!, complete[0]!];
    const { sorted, closedMs } = summarizeCell(list);
    expect(sorted[0]).toBe(complete[0]);
    expect(closedMs).toBe(8 * 60 * 60 * 1000);
  });
});

describe("labels", () => {
  it("time-off labels and states", () => {
    expect(timeOffLabel(timeOffStateFor("PERSONAL"))).toBe("PTO");
    expect(timeOffLabel(timeOffStateFor("OTHER"))).toBe("Off");
    expect(timeOffLabel("complete")).toBe("");
  });
  it("initials", () => {
    expect(timeInitials("Aaliyah Hernandez")).toBe("AH");
    expect(timeInitials("Cher")).toBe("CH");
    expect(timeInitials("  ")).toBe("—");
  });
  it("aria label lists each punch span", () => {
    expect(cellAriaLabel("complete", complete, "America/New_York")).toBe("9:00a to 5:00p");
    expect(cellAriaLabel("missed", [], "America/New_York")).toBe("No punches — missed day");
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run lib/time-grid/cell-state.test.ts`
Expected: FAIL, cannot resolve `./cell-state`.

- [ ] **Step 3: Implement**

`lib/time-grid/cell-state.ts` — move the page's `CellState`, `cellPillClasses`, `legendDotClass`, `MOBILE_STATUS`, `timeInitials`, `timeOffStateFor`, `timeOffLabel` and `cellAriaLabel` verbatim (exporting each), and add:

```ts
import { isAmbiguousSinglePunch, isMissingClockInPunch, isOpenShiftPunch } from "@/lib/punches/missing-punch";

export type TimeOffType = "UNPAID" | "SICK" | "PERSONAL" | "OTHER";
export type PunchLite = { clockIn: Date; clockOut: Date | null };

/** The per-cell rule the grid, the phone list and the day strip all share. */
export function cellStateFor(args: {
  punches: PunchLite[];
  offType: TimeOffType | undefined;
  dayIso: string;
  today: string;
  employeeActive: boolean;
}): CellState {
  const { punches, offType, dayIso, today, employeeActive } = args;
  let state: CellState;
  if (punches.length === 0) {
    if (offType) state = timeOffStateFor(offType);
    else if (dayIso > today) state = "future";
    else state = "missed";
  } else if (punches.some((p) => isAmbiguousSinglePunch(p) || isMissingClockInPunch(p) || isOpenShiftPunch(p))) {
    state = "incomplete";
  } else state = "complete";
  if (!employeeActive) state = "inactive";
  return state;
}

/** Punches sorted by clock-in, plus the closed-punch duration. */
export function summarizeCell(punches: PunchLite[]): { sorted: PunchLite[]; closedMs: number } {
  const sorted = [...punches].sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
  const closedMs = sorted.reduce((acc, p) => (p.clockOut ? acc + (p.clockOut.getTime() - p.clockIn.getTime()) : acc), 0);
  return { sorted, closedMs };
}
```

Check the signatures of `isAmbiguousSinglePunch` etc. in `lib/punches/missing-punch.ts`: if they need more than `PunchLite`, widen `PunchLite` to the fields they read (keep it a structural type, not the Drizzle row).

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run lib/time-grid/cell-state.test.ts`
Expected: PASS 13/13. The "aria label" expectation assumes `formatTimeShort` output `9:00a`; if the real output differs, the TEST was wrong about today's behaviour: fix the expectation to the current output, never the function.

- [ ] **Step 5: Swap the page**

In `page.tsx`: delete the moved definitions; import from `@/lib/time-grid/cell-state`; replace the body of the page's `cellFor` with calls to `cellStateFor` + `summarizeCell` (keep `cellFor` as a thin page-local closure that adds `cellPeriodId` via `resolveTimeCellPeriodId`); replace the desktop grid's inline state block (the `let state: CellState; if (list.length === 0) ...` duplicate) with the same two calls.

```bash
npm run typecheck && npx vitest run 2>&1 | grep "Tests " && npx next build >/dev/null && npm run golden:check 2>&1 | tail -1
```

Expected: `ALL GOLDENS IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add lib/time-grid "app/(admin)/time/page.tsx"
git commit -m "refactor(time): cell-state rules in lib/time-grid

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `lib/time-grid/kpis.ts`

**Files:**
- Create: `lib/time-grid/kpis.ts`, `lib/time-grid/kpis.test.ts`
- Modify: `app/(admin)/time/page.tsx` (delete the KPI/rail maths block: `totalMinutes`, `minutesByEmp`, `fmtHm`, `teamSize`, `clockedInToday`, `teamPct`, `openNow`, OT split, `overtimeRisk`, `unpairedCount`, `todaySummary`, `summaryTotal`, `hoursByDay`, `staleOpenPunchCount`, `issuesByDay`, `mobileSummary`)

**Interfaces:**
- Produces:
  - `fmtHm(mins: number): string`
  - `computeGridKpis(args: { punches: PunchLite[] & { employeeId: string }[]; employees: { id: string; status: string }[]; days: string[]; today: string; tz: string; cellState: (employeeId: string, dayIso: string) => CellState }): GridKpis` where `GridKpis = { totalMinutes; regularMin; overtimeMin; overtimeRisk; teamSize; clockedInToday; teamPct; openNow; unpairedCount; staleOpenPunchCount; todaySummary: { present; incomplete; missing; timeOff; unpaid }; summaryTotal; hoursByDay: number[]; issuesByDay: Map<string, number> }`
  - `mobileSummaryLine(states: CellState[]): string`

- [ ] **Step 1: Write the failing tests**

`lib/time-grid/kpis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeGridKpis, fmtHm, mobileSummaryLine } from "./kpis";
import { cellStateFor, type CellState } from "./cell-state";

const tz = "America/New_York";
const at = (s: string) => new Date(s);
const p = (employeeId: string, i: string, o: string | null) => ({ employeeId, clockIn: at(i), clockOut: o ? at(o) : null });
const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
const employees = [{ id: "a", status: "ACTIVE" }, { id: "b", status: "ACTIVE" }, { id: "c", status: "ACTIVE" }];
const punches = [
  p("a", "2026-10-05T13:00:00Z", "2026-10-05T21:00:00Z"), // 8h Mon
  p("a", "2026-10-06T13:00:00Z", null),                   // open today
  p("b", "2026-10-05T13:00:00Z", "2026-10-06T05:00:00Z"), // 16h Mon (long)
  p("b", "2026-10-06T13:00:00Z", "2026-10-06T21:00:00Z"), // 8h today
  p("c", "2026-10-05T13:00:00Z", null),                   // stale open from yesterday
];
const byCell = new Map<string, typeof punches>();
for (const x of punches) { const k = `${x.employeeId}|${x.clockIn.toISOString().slice(0, 10)}`; byCell.set(k, [...(byCell.get(k) ?? []), x]); }
const cellState = (e: string, d: string): CellState =>
  cellStateFor({ punches: byCell.get(`${e}|${d}`) ?? [], offType: undefined, dayIso: d, today: "2026-10-06", employeeActive: true });

describe("computeGridKpis", () => {
  const k = computeGridKpis({ punches, employees, days, today: "2026-10-06", tz, cellState });
  it("sums closed minutes and splits overtime at 40h per employee", () => {
    expect(k.totalMinutes).toBe(32 * 60);
    expect(k.regularMin).toBe(32 * 60);
    expect(k.overtimeMin).toBe(0);
  });
  it("flags overtime risk at 35h+ (87.5% of 40)", () => {
    expect(k.overtimeRisk).toBe(0);
    const heavy = computeGridKpis({ punches: [p("a", "2026-10-05T00:00:00Z", "2026-10-06T12:00:00Z")], employees, days, today: "2026-10-06", tz, cellState });
    expect(heavy.overtimeRisk).toBe(1);
  });
  it("counts who clocked in today and the open shifts started today", () => {
    expect(k.clockedInToday).toBe(2);
    expect(k.teamSize).toBe(3);
    expect(k.teamPct).toBe(67);
    expect(k.openNow).toBe(1);
  });
  it("counts stale open punches from before today", () => {
    expect(k.staleOpenPunchCount).toBe(1);
  });
  it("buckets today's summary from the cell states", () => {
    expect(k.todaySummary).toEqual({ present: 1, incomplete: 1, missing: 1, timeOff: 0, unpaid: 0 });
    expect(k.summaryTotal).toBe(3);
  });
  it("hours by day feeds the sparkline", () => {
    expect(k.hoursByDay[0]).toBe(24);
    expect(k.hoursByDay[1]).toBe(8);
    expect(k.hoursByDay.length).toBe(7);
  });
  it("issues by day marks past days with an incomplete cell and never today", () => {
    expect(k.issuesByDay.get("2026-10-05")).toBe(1);
    expect(k.issuesByDay.get("2026-10-06")).toBe(0);
  });
});

describe("fmtHm / mobileSummaryLine", () => {
  it("formats hours and minutes", () => {
    expect(fmtHm(950.5 * 60)).toBe("950h 30m");
    expect(fmtHm(0)).toBe("0h 0m");
  });
  it("lists only the non-zero buckets", () => {
    expect(mobileSummaryLine(["complete", "complete", "missed", "pto"])).toBe("2 complete · 1 missing · 1 off");
    expect(mobileSummaryLine([])).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run lib/time-grid/kpis.test.ts`
Expected: FAIL, cannot resolve `./kpis`.

- [ ] **Step 3: Implement**

`lib/time-grid/kpis.ts` — move the page's maths into one function, same arithmetic, same thresholds:

```ts
import { companyDayIso } from "@/lib/time/company-day";
import { isAmbiguousSinglePunch, isMissingClockInPunch } from "@/lib/punches/missing-punch";
import type { CellState, PunchLite } from "./cell-state";

const OT_MIN = 40 * 60;

export function fmtHm(mins: number): string {
  return `${Math.floor(mins / 60).toLocaleString()}h ${Math.round(mins % 60)}m`;
}

export type GridKpis = {
  totalMinutes: number; regularMin: number; overtimeMin: number; overtimeRisk: number;
  teamSize: number; clockedInToday: number; teamPct: number; openNow: number;
  unpairedCount: number; staleOpenPunchCount: number;
  todaySummary: { present: number; incomplete: number; missing: number; timeOff: number; unpaid: number };
  summaryTotal: number; hoursByDay: number[]; issuesByDay: Map<string, number>;
};

export function computeGridKpis(args: {
  punches: (PunchLite & { employeeId: string })[];
  employees: { id: string; status: string }[];
  days: string[];
  today: string;
  tz: string;
  cellState: (employeeId: string, dayIso: string) => CellState;
}): GridKpis {
  const { punches, employees, days, today, tz, cellState } = args;
  const dayOf = (d: Date) => companyDayIso(d, tz);
  let totalMinutes = 0;
  const minutesByEmp = new Map<string, number>();
  for (const p of punches) {
    if (!p.clockOut) continue;
    const mins = (p.clockOut.getTime() - p.clockIn.getTime()) / 60000;
    if (mins <= 0) continue;
    totalMinutes += mins;
    minutesByEmp.set(p.employeeId, (minutesByEmp.get(p.employeeId) ?? 0) + mins);
  }
  const active = employees.filter((e) => e.status === "ACTIVE");
  const teamSize = active.length;
  const clockedInToday = new Set(punches.filter((p) => dayOf(p.clockIn) === today).map((p) => p.employeeId)).size;
  const teamPct = teamSize ? Math.round((clockedInToday / teamSize) * 100) : 0;
  const openNow = punches.filter((p) => p.clockOut === null && dayOf(p.clockIn) === today).length;
  let regularMin = 0, overtimeMin = 0;
  for (const m of minutesByEmp.values()) {
    if (m > OT_MIN) { regularMin += OT_MIN; overtimeMin += m - OT_MIN; } else regularMin += m;
  }
  const overtimeRisk = [...minutesByEmp.values()].filter((m) => m >= OT_MIN * 0.875).length;
  const unpairedCount = punches.filter((p) => isAmbiguousSinglePunch(p) || isMissingClockInPunch(p)).length;
  const staleOpenPunchCount = punches.reduce((n, p) => (p.clockOut === null && dayOf(p.clockIn) < today ? n + 1 : n), 0);
  const todaySummary = { present: 0, incomplete: 0, missing: 0, timeOff: 0, unpaid: 0 };
  for (const e of active) {
    const s = cellState(e.id, today);
    if (s === "complete") todaySummary.present++;
    else if (s === "incomplete") todaySummary.incomplete++;
    else if (s === "missed") todaySummary.missing++;
    else if (s === "unpaid") todaySummary.unpaid++;
    else if (s === "pto" || s === "sick" || s === "other") todaySummary.timeOff++;
  }
  const summaryTotal = todaySummary.present + todaySummary.incomplete + todaySummary.missing + todaySummary.timeOff + todaySummary.unpaid;
  const hoursByDay = days.map((d) => {
    let mins = 0;
    for (const p of punches) { if (p.clockOut && dayOf(p.clockIn) === d) mins += (p.clockOut.getTime() - p.clockIn.getTime()) / 60000; }
    return Math.round((mins / 60) * 10) / 10;
  });
  const issuesByDay = new Map(days.map((d) => [d, d === today ? 0 : employees.reduce((n, e) => n + (cellState(e.id, d) === "incomplete" ? 1 : 0), 0)]));
  return { totalMinutes, regularMin, overtimeMin, overtimeRisk, teamSize, clockedInToday, teamPct, openNow, unpairedCount, staleOpenPunchCount, todaySummary, summaryTotal, hoursByDay, issuesByDay };
}

export function mobileSummaryLine(states: CellState[]): string {
  const count = (st: CellState[]) => states.filter((s) => st.includes(s)).length;
  const parts = [[count(["complete"]), "complete"], [count(["incomplete"]), "unpaired"], [count(["missed"]), "missing"], [count(["pto", "sick", "unpaid", "other"]), "off"]] as const;
  return parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(" · ");
}
```

Note one deliberate equivalence to verify while swapping: today's page computes `todaySummary` from the grid map and `offType`, with the "future" case unreachable for today; `cellState(e.id, today)` yields the same buckets. The `/time` golden is the proof.

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run lib/time-grid/kpis.test.ts`
Expected: PASS. If a figure differs from the expectation, re-derive the expectation from the punch fixture by hand before touching the code; the arithmetic must stay the page's.

- [ ] **Step 5: Swap the page**

Replace the KPI block with `const kpis = computeGridKpis({ punches: punchesInRange, employees, days, today, tz: company.timezone, cellState: (eid, d) => cellFor(employeeById.get(eid)!, d).state })` (build `employeeById` once) and `const mobileSummary = mobileSummaryLine(mobileRows.map((r) => r.state))`; use `kpis.x` at each former variable's use site. Delete `issuesByDay`/`mobileSummary` computations.

```bash
npm run typecheck && npx vitest run 2>&1 | grep "Tests " && npx next build >/dev/null && npm run golden:check 2>&1 | tail -1
```

Expected: `ALL GOLDENS IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add lib/time-grid "app/(admin)/time/page.tsx"
git commit -m "refactor(time): grid KPI maths in lib/time-grid/kpis

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Split the time page's JSX into `components/time/`

**Files:**
- Create: `components/time/day-strip.tsx`, `attendance-list.tsx`, `punch-cell.tsx`, `desktop-grid.tsx`, `kpi-cards.tsx`, `legend.tsx`, `today-summary-card.tsx`, `exceptions-queue-card.tsx`, `labor-hours-card.tsx`, `insight-card.tsx`, `period-pager.tsx`, `time-actions.tsx`
- Modify: `app/(admin)/time/page.tsx` → under 300 lines

**Interfaces** (props in, markup out; every component is a server component unless it already contains client hooks — none of these do):

| Component | Source in `page.tsx` (current function/section) | Props |
|---|---|---|
| `PeriodPager` | the `<div className="flex items-center gap-1 max-lg:rounded-input …">` block with prev/next/Today | `{ period: PeriodView; lastDay: string; adjacent: { prevId: string|null; nextId: string|null }; tab: ScheduleTab }` |
| `TimeActions` | the `grid grid-cols-3 … sm:flex` action cluster + legend row | `{ lastPoll: LastPollProps | null }` (type = the object built for `PollPunchesNowButton`'s `initialLast`) |
| `Legend` | `function Legend` | unchanged |
| `KpiCards` | the KPI `<div className="grid grid-cols-2 …">` + `function KpiCard` | `{ kpis: GridKpis; dayCount: number }` |
| `DayStrip` | the `<nav aria-label="Day">` block | `{ days: string[]; selectedDay: string; today: string; issuesByDay: Map<string, number>; tab: ScheduleTab; periodId: string }` |
| `AttendanceList` | the `lg:hidden` heading + `<ul>` | `{ rows: MobileRow[]; selectedDay: string; today: string; summary: string; tz: string; returnTo: string }` where `MobileRow = ReturnType<typeof cellFor>` exported from the page as a type, or better defined in `cell-state.ts` as `CellSummary & { e: EmployeeLite; cellPeriodId: string | null }` |
| `DesktopGrid` + `PunchCell` | the `hidden lg:block` table and `function PunchCellContent` + `cellAriaLabel` use | `{ employees; days; today; tz; cellFor; returnTo }` |
| `TodaySummaryCard`, `ExceptionsQueueCard`, `LaborHoursCard`, `MiloInsightCard`, `Sparkline` | the five rail functions | unchanged signatures |

- [ ] **Step 1: Move the rail cards (lowest risk first)**

Cut `TodaySummaryCard`, `SUMMARY_SEGMENTS`, `ExceptionsQueueCard`, `Sparkline`, `LaborHoursCard`, `MiloInsightCard` and `KPI_TONE`/`KpiCard` out of `page.tsx` into the files above, `export` each, add the imports they need (`Link`, lucide icons, `fmtHm` from `@/lib/time-grid/kpis`), and import them in the page.

```bash
npm run typecheck && npx next build >/dev/null && npm run golden:check 2>&1 | tail -1
```
Expected: `ALL GOLDENS IDENTICAL`. Commit: `git commit -am "refactor(time): rail and KPI cards into components/time"` (with the attribution trailer).

- [ ] **Step 2: Move the desktop grid and the punch cell**

`components/time/punch-cell.tsx` gets `PunchCellContent` (renamed `PunchCell`, same props) and imports `cellPillClasses`, `isAmbiguousSinglePunch`, `isMissingClockInPunch`, `formatTimeShort`, `formatHoursMinutes` as the page did. `components/time/desktop-grid.tsx` gets the `<div className="hidden lg:block …"><table>…</table></div>` block as `DesktopGrid(props)`; the per-cell body calls `props.cellFor(e, d)` and `cellAriaLabel`. The page passes `cellFor`.

Same gate; commit `refactor(time): desktop grid into components/time`.

- [ ] **Step 3: Move the phone views**

`day-strip.tsx` (`<nav aria-label="Day">` block, plus the heading line with the day name and `summary`), `attendance-list.tsx` (the `<ul>`; `MOBILE_STATUS`, `timeInitials`, `formatTimeShort` imports). Same gate; commit `refactor(time): day strip and attendance list into components/time`.

- [ ] **Step 4: Move the header pieces**

`period-pager.tsx` and `time-actions.tsx` (which wraps `PollPunchesNowButton`, `BackfillPunchesButton`, the two `Button asChild` links and the `Legend` row). Same gate; commit.

- [ ] **Step 5: Final shape check**

```bash
wc -l "app/(admin)/time/page.tsx" components/time/*.tsx
grep -cE "isAmbiguousSinglePunch|OT_MIN|conic-gradient" "app/(admin)/time/page.tsx"   # expect 0: no rules, maths or chrome left in the page
npm run lint 2>&1 | grep -cE "Error:"                                                   # expect 0
npx vitest run --coverage 2>&1 | grep -E "Tests |threshold"
npm run golden:check 2>&1 | tail -1
```

Expected: page under 300 lines, every component under 250 (if `desktop-grid.tsx` is over, split `PunchCell` out is already done; accept up to 280 for the grid and note it), `ALL GOLDENS IDENTICAL`.

- [ ] **Step 6: Commit** (if anything is left uncommitted) and update the briefing

Add to `CLAUDE.md` above `- **Bug-fix discipline.**`:

```markdown
- **Giant-files split, part 1 (Oct 2026, v1.5.4; refactor piece 3 of 4, covering developer).** The rule this piece enforces: **pages fetch, call `lib/`, render components; rules and maths live in `lib/` with tests.** (1) `scripts/golden/` pins the rendered DOM of /time (6 variants), /reports (8), /payroll + 4 period pages and three employee pages: `npx next build && npm run golden:check` runs the built app on :3111 against the local scratch DB `payroll_mobile_ui` under a FROZEN clock (`GOLDEN_NOW=2026-10-06T18:00:00Z`, `scripts/golden/fixed-clock.cjs` via NODE_OPTIONS — never in the Dockerfile), logs in as owner and employee, strips scripts/hashes/SHA/server-time, and diffs against `tests/golden/`. A golden changes ONLY by an explicit decision; `golden:record` rewrites them. Setup (env file, the publish-by-hand step, the SQL that creates a cash-paid period and an acknowledged + a disputed payslip) is in `scripts/golden/README.md`. (2) `lib/time/format.ts` replaced the private copies of `todayInTimezone` (3, two of them in the payroll job handlers), `eachDay` (2), `formatDay`-as-UTC-ymd (2), `fmtTime` (3) and `dayKey` (3); NOT consolidated because they only share a name: `lib/pdf/admin-report.tsx` `fmtTime` (HH:MM string → "9:00a"), `components/domain/punch-row.tsx` `formatDay` (display), `lib/payroll/computePay.ts` `dayKey` (UTC fallback for fixtures). **Latent bug left as-is, pinned by the me-* goldens:** `app/(employee)/me/calendar/page.tsx` `dayKey` formats in the HOST timezone, not `company.timezone`; fixing it is a behaviour change for the owner to approve. (3) `/time` logic moved to `lib/time-grid/`: `period-select.ts` (the "if last week is locked, move on" rules, `nextWindowAfter`, `gridLastDay`), `cell-state.ts` (`cellStateFor` is THE rule for complete/incomplete/missed/time-off/future/inactive, used by the grid, the phone list and the day strip), `kpis.ts` (`computeGridKpis`, 40h OT split, 87.5% risk, today's summary, sparkline, issues-by-day); the DB side is `lib/db/queries/time-grid.ts`. The JSX lives in `components/time/*`; `page.tsx` is under 300 lines. Every step was gated on the goldens being byte-identical. Next: the reports table and the period page, same recipe, own plans.
```

```bash
npm version 1.5.4 --no-git-tag-version
git add CLAUDE.md package.json package-lock.json && git commit -m "docs: giant-files split part 1 briefing; v1.5.4

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Deploy and verify on LX120

Stop and get the user's go-ahead first (a push auto-deploys).

- [ ] **Step 1: Pre-flight**

```bash
ssh root@192.168.1.190 "pct exec 120 -- bash -c 'df -h / | tail -1; date -u +%H:%M; cd /opt/payroll && docker compose exec -T app cat /app/.git-sha'"
```
Expected: 10 GB+ free; not within ten minutes of the top of the hour.

- [ ] **Step 2: Deploy**

```bash
./deploy.sh
```
Expected: `Deployed and verified: <sha> (health OK)`.

- [ ] **Step 3: Production checks**

```bash
ssh root@192.168.1.190 "pct exec 120 -- bash -c 'cd /opt/payroll && bash deploy/verify-image.sh 2300 | tail -2 && bash scripts/smoke.sh http://localhost:3000 | tail -4'"
```
Expected: `ALL CHECKS PASSED`; smoke `OK` on every path. Then ask the user to open `/time` on their phone and on the desktop once (the desktop grid, a day tap on the phone, the Weekly tab).

---

## Self-Review Notes

- **Spec coverage:** Part 1 harness → Task 1 (routes, normalization, frozen clock, data prep, README, RED/GREEN proof). Part 2 `lib/time/format.ts` → Task 2 (with the two "same name, different job" exclusions and the calendar latent bug documented); `lib/time-grid/*` → Tasks 3–5. Part 3 `components/time/*` → Task 6. Order/shipping and verification → Tasks 6–7. `lib/reports/table-model.ts`, `lib/payroll/period-view.ts` and their components are the next two plans (stated in the header).
- **Spec deviations:** `period-select` keeps the DB queries in `lib/db/queries/time-grid.ts` as the spec says; `gridLastDay` was not named in the spec but is the "canonicalEnd" rule the spec's Review Focus needs pinned. `dayKey` copies in `computePay.ts` and the employee calendar are excluded with reasons.
- **Type consistency:** `PeriodView` is defined once in `period-select.ts` and imported by the queries module and the page; `CellState`/`PunchLite` once in `cell-state.ts`, imported by `kpis.ts`; `GridKpis` once in `kpis.ts`, consumed by `KpiCards`.
- **Review Focus:** items 1, 3, 4 have named tests above; item 2 is pinned by a golden and stated as such; item 5 is a grep check in Task 1.
