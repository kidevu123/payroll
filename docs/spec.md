# Payroll Platform — Ground-Up Rebuild Spec (v2)

> **For:** Claude Code
> **Repo to replace:** `kidevu123/payroll`
> **Treat as:** Greenfield. The legacy repo is reference only — for *what data flows through* and *what artifacts users expect*. No structure, naming, or pattern is carried over.

---

## 1. The Goal

A self-hosted payroll and employee operations platform for a small manufacturing/distribution business. **The owner runs payroll in under five minutes a week.** Everything else is automated. The system reaches into NGTeco (the existing timeclock vendor, no open API), pulls punches on a schedule, detects problems, notifies the right person, generates payslips, and waits for the owner to tap one button.

Three principles, in order:

1. **Automation by default, intervention by exception.** The system runs itself. Humans only see what they need to act on.
2. **Levers, not assumptions.** Every behavior — pay period length, shift definitions, rounding, schedule, who gets notified, deadlines — is a setting the owner controls from the admin UI. The code makes no assumptions that aren't reversible from a settings page.
3. **Single-tenant, single-purpose, single-page outputs.** Self-hosted, one company, gross-pay only (no tax, no ACH, no benefits). Paper outputs (admin signature report, payslips) fit on one US Letter sheet, designed for printing and filing.

**Success metric the owner cares about:** weekly time spent on payroll drops from ~2 hours to <5 minutes, with zero degradation in accuracy or auditability.

**Visual identity:** Clean, professional, restrained. **No emoji anywhere** — not in UI labels, not in PDFs, not in notification text, not in default copy. Status is communicated through iconography (Lucide), color, and clear text. This is non-negotiable.

**Non-goals:** tax filing, W-2s, direct deposit, ACH, benefits, multi-tenant SaaS, native mobile apps. PWA only.

---

## 2. Tech Stack (locked)

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 |
| Language | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| DB | Postgres 16 |
| ORM | Drizzle |
| Auth | Auth.js v5, email + password, Argon2id |
| UI | Tailwind v4 + shadcn/ui (copied in, customized) |
| Forms | react-hook-form + Zod (shared client/server schemas) |
| PDF | `@react-pdf/renderer` |
| Files | Local volume (`/data/uploads`), abstracted behind `lib/storage.ts` |
| Email | Nodemailer over SMTP |
| Jobs | `pg-boss` (Postgres-backed, no Redis) |
| Scraper | Playwright (Chromium), runs in same container |
| Telemetry | OpenTelemetry → OTLP env-configurable (default console). Owner runs Grafana stack — instrument from day one. |
| Container | Single multi-stage Dockerfile, deploys to Proxmox LXC |
| i18n | `next-intl`, English + Spanish first-class |

**Project layout:**

```
/app
  /(employee)              # mobile PWA — bottom nav layout
  /(admin)                 # admin dashboard — sidebar layout
  /(auth)
  /api/cron                # job triggers (only API routes; everything else is server actions)
/components
  /ui                      # shadcn primitives
  /domain                  # PayslipCard, PunchRow, PayrollRunStatus, etc.
/lib
  /db                      # Drizzle schema + queries
  /payroll                 # pure functions: computePay, periodBoundaries (Vitest-covered)
  /pdf                     # React-PDF documents
  /ngteco                  # scraper, selector config, fixtures
  /jobs                    # pg-boss handlers
  /notifications           # router: in-app, email, push
  /settings                # typed settings access
  /auth, /telemetry, /storage
/messages
  en.json, es.json
/drizzle                   # migrations
/scripts                   # CLIs: seed, import-legacy, ngteco-test
/docs
```

**Standards:**

- Server components by default; `"use client"` only when needed.
- Server actions are the API. They live in `actions.ts` next to the page, start with `"use server"`, validate input with Zod.
- One Drizzle query per concern in `/lib/db/queries/`. Pages and actions import these.
- **Money is integer cents.** Always. There is a `Money` branded type. Display formatting is the only place cents become dollars.
- **Times are `timestamptz`.** Display respects company timezone (Setting, default `America/New_York`).
- Pure logic in `/lib/payroll` is fully unit-tested.

---

## 3. Domain Model

(See `lib/db/schema.ts` for the canonical Drizzle schema. The original spec text below is preserved for invariants and rationale.)

### Invariants

- `clockOut >= clockIn`. Punches that span midnight are stored as a single record with both timestamps full-dated. **Do not "snap to date."**
- A locked period's punches are immutable. Unlocking is itself an audited action.
- Pay computation reads rate from `EmployeeRateHistory` **as of the punch's `clockIn`**, never the current rate.
- Soft-delete only. Nothing leaves the database.
- Every mutation writes an `AuditLog` row before commit.

---

## 4. Settings — The Lever Panel

Every operational behavior is a setting. The owner adjusts everything from `/admin/settings` without touching code or env (with the exception of secrets).

The Settings page is split into tabs, and each tab maps to a concern. Validation is strict — bad values are rejected at the action layer with clear errors.

### Tabs

- **Company** — name, address, logo, brand color, timezone (default `America/New_York`), locale (default `en-US`)
- **Pay Periods** — length (default 7), startDayOfWeek (default Monday), workingDays (default Mon–Sat), firstStartDate
- **Pay Rules** — rounding (`NONE` | `NEAREST_DOLLAR` | `NEAREST_QUARTER` | `NEAREST_FIFTEEN_MIN_HOURS`), hoursDecimalPlaces (default 2), overtime (default off, threshold 40h, 1.5×)
- **Shifts** — full CRUD, owner-defined (NOT an enum)
- **Automation** — payroll cron (default `0 19 * * 0` = Sunday 7pm), employeeFixWindow (default 24h), suspicious-duration thresholds (default <240min or >840min)
- **NGTeco** — portal URL, encrypted credentials, location, headless toggle, Test Connection, Run Now
- **Notifications** — per event-kind channel toggles. Email is **disabled by default** per owner direction; push + in-app only.
- **Security** — admin 2FA (default off per owner), session timeout (default 30 days), login rate limits (default 5/15min)
- **Holidays** — calendar of observed holidays

**Implementation:** `Setting` is a single `key/jsonb` table. Access is through a typed `getSetting<T>(key)` / `setSetting(key, value)` API in `/lib/settings`, with a Zod schema per key in `/lib/settings/schemas.ts`. Settings are cached in-memory per request, invalidated on write.

---

## 5. NGTeco Automation

The centerpiece. NGTeco has no open API. The system uses Playwright to drive their web portal exactly as a human would, on a schedule.

### Architecture

- **Worker:** A `pg-boss` job named `ngteco.import` that runs in the same container. Triggered by cron (per Settings) or manually.
- **Browser:** Playwright + Chromium, headless by default, persistent context stored at `/data/ngteco/profile/` so cookies survive across runs.
- **Selectors:** Externalized to `/lib/ngteco/selectors.json`. The owner can update selectors when NGTeco changes their UI without redeploying — load the file fresh on each run.
- **Credentials:** Read from `Setting('ngteco.*')`, decrypted with `NGTECO_VAULT_KEY` from env.

### Flow per run

1. Create a `PayrollRun` with `state=INGESTING`. Stamp `ingestStartedAt`.
2. Launch Playwright with persistent context. If session cookies are still valid, skip login.
3. **Login if needed:** fill credentials, submit. Detect 2FA challenge — owner confirmed 2FA is off on the service account; if it's encountered, fail with `INGEST_FAILED`.
4. Navigate to the punch report. Set the date range to the current `PayPeriod`'s `startDate` to `endDate`.
5. **Prefer CSV export.** Click the export button, intercept the download via Playwright's `download` event, save to `/data/ngteco/imports/<run-id>.csv`.
6. **Fallback to scraping** if export is unavailable: parse the visible table, paginate if needed.
7. Parse rows into `PunchCandidate` objects: `{ ngtecoEmployeeRef, clockIn, clockOut, rawData }`.
8. **Match candidates to Employees** by `ngtecoEmployeeRef`. Unmatched candidates create `IngestException` rows.
9. **Dedupe:** compute `ngtecoRecordHash = sha256(employeeRef + clockIn + clockOut)`. Insert only new rows.
10. **Detect missed-punch issues** (see §6.2).
11. Stamp `ingestCompletedAt`. Move state machine to next stage.
12. On error: capture screenshot + page HTML to `/data/ngteco/failures/<run-id>/`, set `state=INGEST_FAILED`, notify admin, increment `retryCount`. Auto-retry up to 3 times with exponential backoff before giving up.

### Anti-fragility

- Selectors live in JSON, editable without redeploying.
- Resilient locators: prefer text content, ARIA roles, and stable test IDs over CSS classes.
- Realistic timing: small randomized delays between actions (200–600ms).
- Dry-run mode for debugging without polluting data.
- A canary fixture: a saved HTML snapshot of NGTeco's report page; the parser is unit-tested against it.

---

## 6. The Payroll Run State Machine

```
SCHEDULED → INGESTING
  (success)  → AWAITING_EMPLOYEE_FIXES (if alerts) or AWAITING_ADMIN_REVIEW
  (failure)  → INGEST_FAILED (after 3 retries)

AWAITING_EMPLOYEE_FIXES
  (resolved or window expired) → AWAITING_ADMIN_REVIEW

AWAITING_ADMIN_REVIEW
  (approve) → APPROVED → PUBLISHED (auto, generates PDFs and notifications)
  (reject/edit) → AWAITING_ADMIN_REVIEW

PUBLISHED       (terminal happy path)
INGEST_FAILED   (terminal failure; admin can retry manually)
CANCELLED       (admin cancel before publish)
```

### Missed-punch detection (after ingest)

For each ACTIVE Employee × each working day in the period:

- **NO_PUNCH** — no Punch row, employee not on approved time-off, day is not a holiday → alert
- **MISSING_OUT** — Punch with null `clockOut` and `clockIn` >18 hours ago → alert
- **MISSING_IN** — clock-out exists but no in → alert
- **SUSPICIOUS_DURATION** — duration outside the configured short/long thresholds → warning

Each alert creates a `MissedPunchAlert` and notifies the affected employee with deadline = `now + automation.employeeFixWindow.hours`.

### Auto-publish on approval

1. State → APPROVED
2. Background job generates all Payslip PDFs in parallel
3. Generates the admin signature report PDF
4. State → PUBLISHED, `publishedAt` stamped
5. Each employee notified with a link to their payslip
6. Admin gets confirmation with download links

Total elapsed time for the admin from "open dashboard" to "done": **target <3 minutes** for a clean run.

---

## 7. Pay Computation

Pure function in `/lib/payroll/computePay.ts`. 100% Vitest branch coverage required.

```ts
function computePay(input: {
  punches: Punch[];                 // non-voided, in period
  rateAt: (p: Punch) => number;     // cents, looked up from EmployeeRateHistory
  taskPay: TaskPayLineItem[];
  rules: {
    rounding: RoundingRule;
    hoursDecimalPlaces: number;
    overtime?: { thresholdHours: number; multiplier: number };
  };
}): {
  byDay: { date: string; hours: number; cents: number; isOvertime: boolean }[];
  totalHours: number;
  regularCents: number;
  overtimeCents: number;
  taskCents: number;
  grossCents: number;
  roundedCents: number;
}
```

- Hours per punch = `(clockOut - clockIn)` in ms → hours, rounded to `hoursDecimalPlaces` (default 2).
- Incomplete punch (null clockOut) contributes zero, surfaces in the run's exceptions.
- Rounding rules:
  - `NONE` → `roundedCents = grossCents`
  - `NEAREST_DOLLAR` → round to whole dollars (banker's rounding)
  - `NEAREST_QUARTER` → round to nearest $0.25
  - `NEAREST_FIFTEEN_MIN_HOURS` → round each day's hours to nearest 0.25h before pay calc

Test fixtures in `/lib/payroll/__fixtures__/` cover real-shape data: short days, suspiciously long days, midnight crossings, mid-period rate changes, flat-task-only employees, mixed task + hourly.

---

## 8. User Roles & Workflows

### Employee (mobile PWA)

Bottom nav, four tabs: **Home · Time · Pay · Profile**

- **Home** — week stats, alerts, quick actions
- **Time** — calendar strip, per-day cards, fix-request affordance
- **Pay** — payslip list with state pills, download, acknowledge
- **Profile** — photo, contact, language toggle, notification preferences, password, sign out

### Admin

Sidebar: **Dashboard · Employees · Time · Payroll · Requests · NGTeco · Reports · Settings**

- **Dashboard** — Current Payroll Run card (~50% viewport), pending requests widget, period stats, last NGTeco import
- **Employees** — list + drawer detail (profile, rate history, punches, payslips, requests, audit)
- **Time** — calendar grid (employees × days), color-coded cells, click to edit with mandatory edit reason
- **Payroll** — list of all PayrollRuns
- **Requests** — missed punches + time off, inline approve/reject
- **NGTeco** — run history, configuration, test, manual trigger, failure artifacts
- **Reports** — YTD totals, hours-by-employee, period comparisons, CSV export
- **Settings** — see §4

### Owner

Same as admin, plus access to Settings and Audit log. Recovery via CLI (`scripts/admin-reset.ts`) if locked out.

---

## 9. Design System

- **Type:** Inter for UI; JetBrains Mono for numerics in tables.
- **Color:** Stone/zinc neutrals with one signal accent (default teal `#0f766e`, configurable). Status: green/amber/red/blue, used sparingly.
- **Density:** Mobile cards 16px padding, 12px gaps. Admin tables 8px row padding, sticky headers.
- **Radius:** 12px cards, 8px inputs/buttons, 6px chips.
- **Shadows:** `shadow-sm` for raised cards, `shadow-2xl` for modals. Nothing else.
- **Motion:** Tailwind transitions on hover/active. 150ms slide-up for sheets. No page-level animations.
- **Empty states:** Lucide icon in a circle + helpful sentence + primary action. Never "No data."

### Iconography

- **Lucide only.** No emoji glyphs anywhere.
- Semantic mapping: Time → `Clock`, Period → `CalendarDays`, Request → `MessageSquareWarning`, Approve → `CircleCheck`, Reject → `CircleX`, Money → `Receipt` (admin), NGTeco → `Workflow`, Settings → `Settings2`.

### Domain components

`<PayslipCard />`, `<PunchRow />`, `<StatusPill />`, `<MoneyDisplay />`, `<HoursDisplay />`, `<ShiftChip />` (replaces emoji glyphs), `<ExceptionBadge />`, `<RequestForm />`, `<PayrollRunCard />`.

---

## 10. PDF Outputs

Two PDFs per period, both single-page US Letter portrait, designed for printing and filing. **No emoji, no decorative glyphs.**

### Individual Payslip

Header band (logo, "Pay Statement", period dates) → employee block → daily table (Date · In · Out · Hours · Pay) → subtotals → task pay/adjustments → total card with rounding rule named → footer.

### Admin Period Signature Report

Single page, all employees, grouped by shift with subtotals: Shift | Name | ID | Hours | Rounded Pay | Signature line | Date line. Per-shift totals + grand total at bottom.

**Hard constraint:** must fit ~25 employees on one page. Compress row height before adding a second page. A second page is a regression.

### Cut-Sheet Payslip Mode (optional)

Mini-payslips tiled 3 columns × N rows on US Letter with dotted cut lines.

---

## 11. Notifications

Three channels, toggleable per user and per event kind:

- **In-app** (always on, bell in nav)
- **Email** — disabled by default per owner direction
- **Browser push** (PWA, opt-in)

| Kind | Default audience | Default channels |
|---|---|---|
| `missed_punch.detected` | Affected employee | in-app, push |
| `missed_punch.request_submitted` | Admins | in-app, push |
| `missed_punch.request_resolved` | Submitting employee | in-app, push |
| `time_off.request_submitted` | Admins | in-app, push |
| `time_off.request_resolved` | Submitting employee | in-app, push |
| `payroll_run.ingest_failed` | Admins | in-app, push |
| `payroll_run.awaiting_review` | Admins | in-app, push |
| `payroll_run.published` | All employees with payslips | in-app, push |
| `period.locked` | Admins | in-app |

Notifications written to `Notification` table. The router `lib/notifications/send.ts` reads recipient preferences and dispatches accordingly. Failures logged but never block the originating action.

---

## 12. Data Migration

Owner confirmed: existing reports and payslips need to remain accessible.

Plan:

1. **Employees:** `scripts/import-employees.ts <csv>` — dry-run by default. Preserves `legacyId`. Title-cases display name while preserving original. Detects suspected `FLAT_TASK` employees and flags for owner review.
2. **NGTeco refs:** owner pastes mapping (legacyId → ngtecoEmployeeRef) in admin UI, or importer prompts for unmatched on first NGTeco run.
3. **Historical punches:** imported as `LOCKED`/`PAID`, `source=LEGACY_IMPORT`. Don't recompute pay.
4. **Original payslip PDFs:** stash at `/data/payslips/legacy/<period>/...` and surface a "Download original PDF" link on legacy period view.
5. **Shifts:** legacy "Day"/"Night" enum migrated to two `Shift` rows. Owner can rename/archive/merge after.

---

## 13. Auth & Security

- Email + password, Argon2id (64MB, 3 iters, 4 parallelism)
- Session cookies HttpOnly + Secure + SameSite=Lax, 30-day rolling
- 2FA optional for admins (TOTP via authenticator app); **default off** per owner direction
- CSRF on all state-changing server actions
- Login rate limit: 5/email/15min, exponential backoff. Postgres-backed.
- Password reset: emailed magic link, single-use, 30min TTL (deferred until email is enabled)
- **Server-side authz check at the action layer**, not just middleware. Defense in depth.
- First-run setup creates exactly one OWNER. All others are invited.
- NGTeco credentials encrypted at rest (AES-GCM, key from `NGTECO_VAULT_KEY` env var)
- All mutations write `AuditLog` before commit

---

## 14. Internationalization

- All strings in `/messages/{en,es}.json`
- Default per user from `Employee.language`
- Login page detects browser locale, manual switcher
- **Spanish is first-class, ships in v1**
- Glossary in `/docs/i18n-glossary.md`
- `Intl` APIs for dates and numbers throughout

---

## 15. Build Phases

Build in order. Each phase ships a working, demonstrable app. Don't start a phase until the prior one is committed and tested.

- **Phase 0 — Foundation.** Done.
- **Phase 1 — Admin core.** Employee CRUD with rate history, Shift CRUD, manual punch entry, period auto-creation, `computePay` pure function with full Vitest coverage, period review/lock, audit log viewer.
- **Phase 2 — NGTeco automation.** Playwright integration, selectors config, login/navigate/export-or-scrape/parse/dedupe/persist, test connection + run now, failure capture, NGTeco admin page, snapshot tests.
- **Phase 3 — Payroll Run state machine.** PayrollRun entity, missed-punch detection, cron-triggered runs, dashboard run card, approve flow, payslip generation, React-PDF documents.
- **Phase 4 — Employee PWA.** Manifest, install prompt, offline shell, all four tabs, mobile-first.
- **Phase 5 — Requests & notifications.** Missed-punch + time-off flows, notification system (in-app + push), admin Requests inbox.
- **Phase 6 — Polish & reports.** Spanish complete, Reports tab (recharts), CSV exports, owner audit log viewer, full docs.
- **Phase 7 — Future hooks.** Don't build, leave doors open: kiosk PIN punch, direct timeclock webhook, direct deposit.

---

## 16. Configurable Levers

Every behavior reachable from `/admin/settings`:

- Pay period length, start day, working days
- Rounding rule and decimal places
- Overtime: enabled, threshold, multiplier
- Shifts: full CRUD, colors, default times
- Automation cron schedule
- Employee fix window (hours)
- Suspicious duration thresholds
- NGTeco credentials, URL, location, headless mode
- Per-event-kind notification channels
- 2FA enforcement
- Session timeout, login rate limits
- Holiday calendar
- Company info: name, logo, brand color, timezone, locale

If something is hardcoded that's plausibly company-specific, that's a bug.

---

## 17. Specific Behaviors That Matter

1. Hours rounded to 2 decimals for display; underlying number is exact computation.
2. Money stored and computed in cents. Display formatting is the only conversion.
3. `roundedPayCents` shown alongside `grossPayCents` on payslips and reports.
4. Pay periods are configurable; legacy data is Mon→Sat with Sunday off, but encode this in Settings.
5. Shift indicators are text labels with a color swatch. **Never emoji.**
6. Employee IDs are alphanumeric (`TEMP_001`, `47`). Don't assume integer.
7. Some employees only worked 1 day in a period. Don't treat short periods as anomalies.
8. Punches genuinely cross midnight. Store both timestamps full-dated.
9. Family-named employees are ordinary Employee records with notes. No special category.
10. One-off contractors with flat fees are `payType=FLAT_TASK`. Recorded as `TaskPayLineItem` per occurrence.
11. Inconsistent name capitalization in legacy data. Display Title Case, preserve original in `legalName`.
12. Generated PDFs go to `/data/payslips/<year>/<period>/...` with predictable naming.

---

## 18. Testing

- **Vitest** for `lib/payroll/*`, `lib/ngteco/parser.ts`, `lib/settings/*`. CI gates on coverage.
- **Playwright** for the three primary workflows (employee acknowledges payslip, admin approves run end-to-end, owner adjusts setting and sees it reflected).
- **Snapshot tests** for the NGTeco scraper against saved HTML fixtures.
- **Seed script** `scripts/seed-demo.ts` creates a realistic 24-employee company with 4 historical periods and one open period with detected exceptions.

---

## 19. Deployment (Proxmox LXC)

- Single Dockerfile, multi-stage, final image bumped by Playwright (~500MB; accepted).
- `docker-compose.yml`: app, postgres, backup sidecar (cron `pg_dump` to `/data/backups`).
- All config via env. `.env.example` committed.
- `/data` is a host mount: `uploads/`, `payslips/`, `ngteco/`, `backups/`.
- One-shot setup: `git clone && cp .env.example .env && docker compose up -d`.
- HTTPS termination at LXC's reverse proxy, not in-app.
- Trusts `X-Forwarded-*` when `TRUST_PROXY=true`.
- OTel exports default to console; `OTEL_EXPORTER_OTLP_ENDPOINT` redirects.

See `docs/deploy-proxmox.md`.

---

## 20. Definition of Done (per phase)

A phase is done when:

1. All listed features work end-to-end in dev and in a fresh Docker spin-up.
2. TypeScript compiles with zero errors and zero `// @ts-expect-error`.
3. Vitest passes with no skipped tests; coverage gate green.
4. Playwright happy-paths pass.
5. Seed demo loads and looks polished.
6. README updated.
7. Drizzle migrations are reversible (`drizzle-kit drop` works cleanly).
8. New telemetry signals are visible.

---

## 21. Owner-confirmed answers

1. Logo/brand color: architect's discretion for now (default teal `#0f766e`).
2. SMTP: not needed. Push + in-app only.
3. NGTeco: 2FA off. URL/credentials entered through Settings UI when ready.
4. Timezone: `America/New_York`.
5. Single shift named "Day". No nightshift.
6. Payroll cron: `0 19 * * 0` (Sunday 7pm ET).
7. Employee fix window: 24 hours (Monday 7pm).
8. Legacy access: existing reports and payslips need to remain accessible (data import + original PDFs preserved).
9. Spanish: ships in v1, pre-populated from glossary.
10. Admin 2FA: off by default; toggle exists.

---

## 22. Anti-patterns

DO NOT:

- Use any emoji in UI, PDFs, copy, default text, or notification payloads. Zero. Use Lucide icons, color swatches, and text labels.
- Hardcode shift names, period boundaries, rounding rules, or any other behavior listed in §16.
- Store money as floats.
- Auto-correct punches. Surface issues; humans decide.
- Add modals for everything. Mobile uses bottom sheets; desktop uses drawers or inline edit.
- Build a 40-toggle Settings page with no organization. Group ruthlessly per §4.
- Toast every action. Toasts are for errors and rare confirmations, not "Saved!" affirmations.
- Couple the NGTeco scraper to specific CSS classes. Use text/role/data-test selectors, externalize, and keep snapshot tests.
- Add features not in this spec without asking.

---

## 23. First commands

For the very first session (spec writer's instructions):

1. Read this spec end to end. Respond with phased plan, ambiguities, and §21 answers. Done.
2. Create a rebuild branch — do not touch main until Phase 1 ships. Done (`rebuild/foundation`).
3. Phase 0 only. Stop after Phase 0 is committed and demonstrably working. Done (locally; bring-up steps in `docs/handoff.md`).

For all subsequent sessions: stop and ask before starting any new phase. Read this spec, read CLAUDE.md, read `docs/handoff.md` if Phase 0 isn't deployed yet.

---

**End of spec. Build it like you're the one who has to use it every Sunday night.**
