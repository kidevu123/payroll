# Multi-phase build plan

This document is the canonical task list for Phases 1-6. Each phase has a goal, an explicit file inventory, the queries/components/tests it adds, what migrations it ships, and a verifiable definition of done. Phase 7 is "future hooks" — do not build, leave the doors open.

The spec is the source of truth (`docs/spec.md`). This document expands the spec's §15 phase outline into concrete deliverables.

**Build order matters.** Don't start Phase N+1 until Phase N's "Done when" gates are all green. Each phase ends with a real deploy to LX120 and a smoke test. If any gate fails, stop, surface, fix, re-verify.

---

## Phase 0.5 — Pre-flight bug fixes

Before starting Phase 1, clear the known Phase 0 issues so they don't compound. None of these are big.

1. **`lib/settings/runtime.ts`** — `setSetting` calls `getSetting` to capture the audit "before" value, but `getSetting` does `schema.parse({})` on missing rows, which throws when the schema has required-with-no-default fields. This causes `/setup` to silently lose company settings. Fix: in `setSetting`, replace the `getSetting(key)` call with a `safeParse` of the raw row's value (or `null` if missing/invalid). Audit "before" becomes nullable. Validation on the new value stays strict.

2. **`lib/db/queries/users.ts`** — `recordSuccessfulLogin` sets `lockedUntil: null` but `exactOptionalPropertyTypes` may reject this against a schema that doesn't declare `null`. If lint/typecheck warns, change the schema to allow `null` or use `lockedUntil: undefined`.

3. **Vitest covering the bug fix** — `setSetting` succeeds when no prior row exists, audit "before" is `null` in that case, and `setSetting` still rejects an invalid new value.

Commit: `fix(settings): tolerate missing prior value in setSetting`.

Verify on LX120: visit `/admin/settings/company`, confirm the company name from /setup is present (or save it from the form), confirm it persists across reload.

---

## Phase 1 — Admin core

> Goal: the admin can manage employees, shifts, and manually-entered punches; pay periods auto-create on schedule; `computePay` is fully unit-tested. The app stops being a shell.

### New queries (`lib/db/queries/`)

- **`employees.ts`** — `listEmployees({ status?, shiftId?, search? })`, `getEmployee(id)`, `createEmployee(input)`, `updateEmployee(id, patch)`, `archiveEmployee(id, reason)` (soft-delete: sets `status=TERMINATED`, never deletes).
- **`shifts.ts`** — `listShifts({ includeArchived })`, `createShift(input)`, `updateShift(id, patch)`, `reorderShifts(orderedIds)`, `archiveShift(id)`.
- **`pay-periods.ts`** — `listPeriods({ limit, before })`, `getCurrentPeriod()`, `getPeriodById(id)`, `lockPeriod(id, actor)`, `unlockPeriod(id, actor, reason)` (audited), `ensureNextPeriod()` (idempotent — creates the next OPEN period if missing per `payPeriod` settings).
- **`punches.ts`** — `listPunches({ periodId, employeeId? })`, `createPunch(input, actor)`, `editPunch(id, patch, actor, reason)` (preserves `originalClockIn/Out`), `voidPunch(id, actor, reason)`.
- **`rate-history.ts`** — `listRates(employeeId)`, `addRate(employeeId, input, actor)` (also updates the denormalized `employees.hourlyRateCents` cache to the latest by `effectiveFrom`).
- **`audit.ts` (extend)** — `listAudit({ before, limit, actorId?, targetType? })` for the viewer.

Every mutation here writes an `audit_log` row before commit. Use a Drizzle transaction; if the audit insert fails, the mutation rolls back.

### New pure logic (`lib/payroll/`)

- **`computePay.ts`** — full implementation per spec §7. Pure function, no I/O.
- **`period-boundaries.ts`** — given a date and `payPeriod` settings, returns `{ startDate, endDate }` of the period that date belongs to. Handles the `firstStartDate` anchor.
- **`rounding.ts`** — extracted rounding rules (`NONE`, `NEAREST_DOLLAR`, `NEAREST_QUARTER`, `NEAREST_FIFTEEN_MIN_HOURS`). `roundCents(cents, rule)` and `roundDailyHours(hours, rule)`.
- **`__fixtures__/`** — JSON files with real-shape inputs:
  - `short-day.json` — single 1.5h punch
  - `suspicious-long.json` — 16h punch (warning, not blocking)
  - `midnight-crossing.json` — clock-in 22:00 Tue, clock-out 06:30 Wed
  - `mid-period-rate-change.json` — rate increased on Wednesday; pre-Wednesday punches use old rate, post use new
  - `flat-task-only.json` — `payType=FLAT_TASK`, only `taskPay` line items, no punches
  - `mixed-task-hourly.json` — both
  - `incomplete-punch.json` — null `clockOut`, contributes zero, surfaces in exceptions

### Tests (Vitest)

- **`lib/payroll/computePay.test.ts`** — 100% branch coverage required, gated in CI. Drives every fixture, snapshots the output.
- **`lib/payroll/period-boundaries.test.ts`** — covers Mon-start, Sun-start, mid-anchor changes, leap years, DST transitions.
- **`lib/payroll/rounding.test.ts`** — banker's rounding for `NEAREST_DOLLAR`, $0.25 buckets for `NEAREST_QUARTER`, 0.25h buckets for `NEAREST_FIFTEEN_MIN_HOURS`, identity for `NONE`.
- **`lib/db/queries/employees.test.ts`** — integration test using a throwaway Postgres database (testcontainer or a `pg` instance the test boots). Covers create → update → archive lifecycle, audit row written.
- Update vitest coverage gate: lines/functions/branches/statements all 100% on `lib/payroll/*`, no gate elsewhere.

### New pages

- **`app/(admin)/employees/page.tsx`** — list with search box, shift filter, status filter, "Add employee" CTA. Uses `<EmployeeRow />`.
- **`app/(admin)/employees/new/page.tsx`** — create form (name, email, phone, hired date, shift, pay type, rate). On submit, creates `Employee` + initial `EmployeeRateHistory` row in the same transaction.
- **`app/(admin)/employees/[id]/page.tsx`** — detail drawer (or full page on desktop). Tabs: Profile, Rate history, Punches, Payslips (placeholder), Requests (placeholder), Audit.
- **`app/(admin)/employees/[id]/edit/page.tsx`** — edit form (no rate change here — that's a separate flow with effective dates).
- **`app/(admin)/employees/[id]/rate/page.tsx`** — add rate change with `effectiveFrom`, reason. Past `effectiveFrom` is allowed (with an admin confirmation) to correct historical errors; this writes audit with reason.
- **`app/(admin)/time/page.tsx`** — calendar grid (employees × days for the current period), color-coded cells (green=complete, amber=incomplete, red=missed, gray=archived/inactive). Click a cell to open punch editor.
- **`app/(admin)/time/[periodId]/[date]/[employeeId]/page.tsx`** — punch editor. Shows existing punch(es) with original timestamps if edited, edit form, edit reason required.
- **`app/(admin)/payroll/page.tsx`** — list of `PayPeriod` rows with state pill, date range, locked-by, paid-at. Click → period review.
- **`app/(admin)/payroll/[periodId]/page.tsx`** — period review screen: per-employee table with hours/gross/exceptions/pill, totals row, lock action (audited).
- **`app/(admin)/audit/page.tsx`** — paginated audit log, filterable by actor / target type / date range. Owner-only.

### New domain components (`components/domain/`)

- **`employee-row.tsx`** — list row with name (display + legal underneath if different), email, shift chip, status pill, latest rate.
- **`shift-chip.tsx`** — colored chip with shift name, color from `Shift.colorHex`. **Replaces emoji glyphs everywhere.**
- **`status-pill.tsx`** — variant-driven (`OPEN`, `LOCKED`, `PAID`, `PENDING`, `APPROVED`, `REJECTED`, `ACTIVE`, `INACTIVE`, `TERMINATED`). One source of truth for state styling.
- **`money-display.tsx`** — `<MoneyDisplay value={cents} rounded={boolean} />`, locale-aware, monospace numerics.
- **`hours-display.tsx`** — `<HoursDisplay value={hours} />`, locale-aware decimal formatting per `pay.hoursDecimalPlaces` setting.
- **`punch-row.tsx`** — date / in / out / hours, "edited" indicator, edit/dispute affordances.
- **`rate-history-list.tsx`** — vertical timeline of rate changes with effective dates and reasons.

### Settings tabs (full implementations, replace Phase 0 stubs)

- **`/settings/pay-periods`** — edit form for length, startDayOfWeek, workingDays (checkbox group), firstStartDate. Guard: editing `firstStartDate` is rejected if any `pay_periods` rows exist; surface a clear error pointing to a `/settings/pay-periods/reset` flow that requires owner role and confirmation.
- **`/settings/pay-rules`** — edit form for rounding rule (radio), decimal places (number input), overtime sub-form (enabled toggle, threshold, multiplier).
- **`/settings/shifts`** — full CRUD: list + reorder (drag), create form (name, color picker, optional default start/end times), edit, archive.
- **`/settings/security`** — admin 2FA toggle (with note explaining it's recommended for production), session timeout in days, login rate limit (max attempts + window minutes).

### New jobs (`lib/jobs/handlers/`)

- **`period-rollover.ts`** — runs daily at 00:30 in `company.timezone`. Calls `ensureNextPeriod()`. Idempotent. Logs the period it created or "no rollover needed."

Wire into pg-boss with `boss.schedule("period.rollover", "30 0 * * *")` and a TZ env var or explicit time conversion.

### Bulk import

- **`scripts/import-employees.ts <csv>`** — CSV → Employee + initial rate history row per `legacyId`. Dry-run by default (prints diffs, doesn't write). `--apply` to commit. Title-cases `displayName`, preserves original in `legalName`. Detects suspected `FLAT_TASK` employees (high apparent rate × low hours) and flags for owner review rather than auto-migrating.

### Migration

- **`drizzle/0001_phase1_indexes.sql`** — generated by `drizzle-kit generate` after the schema additions for Phase 1. Likely no schema changes (everything's already in `lib/db/schema.ts`); could be a no-op or could add an index `employees(status, shift_id)` if list queries need it.

### Demo seed

Update `scripts/seed-demo.ts` to create:

- 24 employees mirroring the legacy data shape (mix of `HOURLY` and `FLAT_TASK`, varied rates, varied hire dates, all assigned to the single "Day" shift). Names should look like real names, not "Test 1, Test 2."
- 4 historical periods with realistic punches (some short days, a few suspiciously long days, occasional midnight crossings).
- 1 open current period with a couple of detected exceptions (NO_PUNCH, MISSING_OUT) so the dashboard has visible content.

The demo must look polished, not like demoware (per spec §18).

### Done when

- Owner can: create/edit/archive employees with rate history, manage shifts (CRUD + reorder + archive), manually enter and edit punches with reason, see periods auto-create on schedule, view the audit log.
- `computePay` has 100% branch coverage in vitest. Coverage gate enforces this in CI.
- Typecheck, lint, and tests pass clean (zero errors, zero `// @ts-expect-error`, no skipped tests).
- Demo seed loads and the empty dashboard is no longer empty (24 employees, 4 historical periods, 1 open period with exceptions).
- `/api/health` still returns 200 with all checks green.
- Drizzle migrations are reversible (`drizzle-kit drop` cleanly).
- README updated with the Phase 1 status.

### Risks / "stop and ask" gates

- **Mid-period rate change splitting.** The spec says "rate as of the punch's clockIn." For a punch crossing a rate-change boundary at midnight, use the rate at clockIn for the entire punch (no proration). This is the literal reading; if a fixture suggests the owner expected proration, surface it.
- **Reorder semantics.** When archiving a shift, what happens to employees assigned to it? Default behavior: keep the assignment (the chip just shows a strikethrough). Don't auto-reassign without owner direction.
- **Manual punch entry: future-dated.** Allowed for scheduled-but-not-yet-clocked entries. Don't block.

---

## Phase 2 — NGTeco automation

> Goal: the owner configures NGTeco credentials in encrypted Settings, hits "Test connection," and triggers a real import. The Sunday cron triggers ingest automatically. Failures capture screenshots; selectors are externalized.

### New libs (`lib/ngteco/`)

- **`selectors.json`** — externalized selector config. Loaded fresh on each run (no module-level caching). Initial set: login form, report navigation, date range pickers, export button, table rows. Use text content / ARIA roles / data-test attributes — **never CSS class selectors**.
- **`scraper.ts`** — Playwright-driven flow. Persistent context at `/data/ngteco/profile/`. Resilient locators. Realistic timing (200-600ms randomized delays).
- **`parser.ts`** — converts CSV (preferred) or scraped HTML rows to `PunchCandidate` objects. Snapshot tested against `__fixtures__/sample-report.html`.
- **`import.ts`** — orchestrator: launch → login if needed → navigate → set date range → export-or-scrape → parse → match candidates by `ngtecoEmployeeRef` → dedupe by `ngtecoRecordHash` → persist Punches → call `detectExceptions(periodId)` → return summary.
- **`__fixtures__/sample-report.html`** — saved snapshot of NGTeco's report page. Used by the parser snapshot test. When NGTeco changes their UI, this test fails before production breaks.
- **`__fixtures__/sample-export.csv`** — saved CSV. Used by parser tests.

### Integration with Settings

- **`lib/settings/runtime.ts`** — already has the `ngteco` schema. Add `setNgtecoCredentials(plaintextUsername, plaintextPassword, actor)` which seals via `lib/crypto/vault.ts` before writing. Reads stay through `getSetting("ngteco")` and explicitly do NOT decrypt — only `lib/ngteco/import.ts` decrypts (with role check).

### New pages

- **`app/(admin)/settings/ngteco/page.tsx`** — full config form: portal URL, locationId, username (write-only), password (write-only), headless toggle. Two action buttons: **Test connection** (kicks a short Playwright job, waits up to 30s for screenshot result), **Run import now** (creates an ad-hoc PayrollRun outside the cron schedule).
- **`app/(admin)/ngteco/page.tsx`** — run history. Table of last 30 runs: started_at, duration, state pill, punches_imported, exceptions_count.
- **`app/(admin)/ngteco/[runId]/page.tsx`** — run detail. Shows full timeline (login → navigate → export → parse → match → persist with timing per step), exceptions list (unmatched candidates), and on failure: inline screenshot + page HTML.

### New jobs

- **`lib/jobs/handlers/ngteco-import.ts`** — pg-boss handler for `ngteco.import`. Wraps `lib/ngteco/import.ts` with retries (up to 3, exponential backoff), failure capture, OTel spans (`ngteco.run`, `ngteco.login`, `ngteco.navigate`, `ngteco.export`, `ngteco.parse`, `ngteco.match`, `ngteco.persist`).
- **`lib/jobs/handlers/payroll-run-tick.ts`** — runs on `automation.payrollRun.cron`. Creates a `PayrollRun` in `SCHEDULED`, then immediately enqueues `ngteco.import` for it.

### New tables / migrations

The schema already has `IngestException` implicitly via `payroll_runs.exception_snapshot` (jsonb). For Phase 2 we promote unmatched candidates to a real table for queryability:

- **`drizzle/0002_ingest_exceptions.sql`** —
  ```
  CREATE TABLE ingest_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    type text NOT NULL,            -- 'UNMATCHED_REF', 'PARSE_ERROR', 'DUPLICATE_HASH'
    ngteco_employee_ref text,
    raw_data jsonb,
    resolved_at timestamptz,
    resolved_by_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX ingest_exceptions_run_idx ON ingest_exceptions (payroll_run_id);
  ```
- Add the matching `pgTable` definition in `lib/db/schema.ts`.

### Telemetry signals

- Counters: `ngteco_runs_total{outcome}`, `ngteco_punches_imported_total`, `ngteco_exceptions_total{type}`.
- Spans: as listed above.
- Logs: structured JSON with `runId` field. Always.

### Done when

- Owner configures credentials through `/settings/ngteco`, plaintext is encrypted at rest with AES-GCM, never logged.
- Test Connection returns success/failure with screenshot evidence within 30s.
- Manual "Run import now" creates a `PayrollRun` with `state=INGESTING`, runs the scraper, transitions to `AWAITING_EMPLOYEE_FIXES` or `AWAITING_ADMIN_REVIEW`.
- Cron-triggered run on Sunday 7pm ET behaves identically.
- Failure produces a screenshot + page HTML at `/data/ngteco/failures/<run-id>/` and notifies admin via in-app + push.
- Snapshot tests pass against the saved fixtures.
- Selector changes are possible without redeploying — owner edits `lib/ngteco/selectors.json` on the LXC, the next run picks them up.
- Coverage gate: `lib/ngteco/parser.ts` at 100% branch coverage.

### Risks / "stop and ask" gates

- **NGTeco service account 2FA.** Owner confirmed it's off (§21 #3). If the scraper detects a 2FA challenge anyway, fail with `INGEST_FAILED`, notify admin, do not retry.
- **Bot detection.** If NGTeco starts showing CAPTCHA or rate-limit pages, capture and stop. Do not try to circumvent.
- **First-run unmatched references.** On the very first import, every candidate is unmatched (Employee.ngtecoEmployeeRef is null until the owner maps them). Surface every distinct ref with a "Bind to existing employee" UI on `/ngteco/[runId]/page.tsx`. Don't auto-create employees.

---

## Phase 3 — Payroll Run state machine + PDFs

> Goal: Sunday 7pm cron kicks a run; missed-punch detection runs; admin reviews + approves; payslips generate; PDFs land in `/data/payslips/`. The dashboard's "Current payroll run" card becomes the centerpiece described in spec §8.2.

### New queries

- **`lib/db/queries/payroll-runs.ts`** — `getCurrentRun()` (the run for the active period), `getRun(id)`, `transitionRun(id, newState, actor, metadata)` (audited; rejects illegal transitions).
- **`lib/db/queries/alerts.ts`** — `listAlertsForPeriod(periodId, { unresolved? })`, `createAlert(input)`, `resolveAlert(id, requestId?, actor)`.
- **`lib/db/queries/payslips.ts`** — `listPayslipsForPeriod(periodId)`, `getPayslipForEmployeePeriod(employeeId, periodId)`, `markAcknowledged(id, actor)`.

### New jobs (`lib/jobs/handlers/`)

- **`payroll-run.ts`** — orchestrates the full state machine. Handlers:
  - `payroll.run.create` — creates a `PayrollRun` in `SCHEDULED`, enqueues `ngteco.import`.
  - `payroll.run.detect-exceptions` — after ingest, runs `detectExceptions(periodId)` per spec §6.2, transitions to `AWAITING_EMPLOYEE_FIXES` (if alerts exist) or `AWAITING_ADMIN_REVIEW`.
  - `payroll.run.fix-window-expire` — scheduled `now + automation.employeeFixWindowHours`. Transitions `AWAITING_EMPLOYEE_FIXES` → `AWAITING_ADMIN_REVIEW`.
  - `payroll.run.publish` — on admin approve: generates all payslips in parallel, generates the admin signature report PDF, transitions to `PUBLISHED`, dispatches notifications.
- **`payslip-generate.ts`** — pure PDF generation per employee per run. Uses the React-PDF documents in `lib/pdf/`. Writes to `/data/payslips/<year>/<period>/<employee-id>.pdf`. Idempotent — replaces an existing file.
- **`missed-punch-detect.ts`** — pure detection per §6.2. Returns a list of alerts to create.

### New PDF documents (`lib/pdf/`)

- **`payslip.tsx`** — single-page US Letter individual payslip (spec §10.1). Uses `@react-pdf/renderer`. Brand color from setting. **No emoji.** Shift indicated by text label + tiny color swatch. Numbers monospace, right-aligned.
- **`signature-report.tsx`** — single-page admin signature report (spec §10.2). Hard constraint: ~25 employees on one page. Compress row height before adding a second page.
- **`cut-sheet.tsx`** — optional 3 columns × N rows tiling (spec §10.3). Triggered by checkbox in print dialog.
- **`__fixtures__/`** — JSON inputs for snapshot tests.
- **`payslip.test.tsx`** — render to PDF buffer, snapshot test (string-compare key text content; not pixel-diff).

### New pages

- **`app/(admin)/dashboard/page.tsx`** — REPLACE the empty card with `<PayrollRunCard />`. The dashboard is now opinionated about what matters.
- **`app/(admin)/payroll/[runId]/page.tsx`** — run detail / review screen. Per-employee table with hours / gross / rounded / exceptions. State-driven action buttons. The Approve button requires acknowledging any remaining warnings before unlocking. Confirmation modal: "About to publish payroll for $X across N employees — confirm?"
- **`app/(employee)/pay/[periodId]/page.tsx`** — payslip viewer. Iframe the PDF + show "Acknowledge" button. Acknowledgment writes audit row.

### New domain components

- **`payroll-run-card.tsx`** — the dashboard centerpiece. State-driven UI: different layout per `PayrollRunState`. Each state has one primary CTA. Designed to fill ~50% of viewport.
- **`payslip-card.tsx`** — three states: pending, published, acknowledged. Used in employee Pay tab.
- **`exception-badge.tsx`** — semantic icon + tooltip for each `MissedPunchIssue` type.

### Notifications wiring (precursor to Phase 5)

Wire the in-app channel for these event kinds (push and email come in Phase 5):

- `missed_punch.detected` → affected employee
- `payroll_run.awaiting_review` → admins
- `payroll_run.published` → all employees with payslips
- `payroll_run.ingest_failed` → admins

Use a stub `lib/notifications/in-app.ts` that just writes to the `notifications` table. Phase 5 promotes this to the full router.

### Done when

- Cron-triggered run goes through the full state machine with no manual intervention required when there are no exceptions.
- Missed-punch alerts created for ACTIVE employees with no punches on a working day, employee not on approved time-off, day not a holiday.
- Admin "Approve" generates all PDFs, transitions to `PUBLISHED`, fires notifications.
- `/data/payslips/<year>/<period>/` has one PDF per employee + one `signature-report.pdf`.
- The single-page admin report fits 25 employees on one page (visual verification required).
- Dashboard shows the run card front and center; click-through to review screen works.
- Total elapsed time for the admin from "open dashboard" to "done" on a clean run is under 3 minutes (spec §6.5 target).
- `/api/health` still 200.

### Risks / "stop and ask" gates

- **Dashboard centerpiece visual polish.** Spec is explicit about ~50% viewport, state-driven UI. Iterate on this until it feels like the heart of the app, not a checkbox. Owner will see this every Sunday.
- **Single-page constraint.** If 25 employees doesn't fit on one signature report page with the current font/layout, compress row height, line-height, padding before splitting. A second page is a regression.
- **PDF accuracy.** The `roundedPayCents` shown alongside `grossPayCents` must match what the Run actually paid out. If they ever drift, that's a bug.
- **Acknowledgment UX.** Don't put it in a modal. Inline button on the payslip viewer.

---

## Phase 4 — Employee PWA

> Goal: employees can sign in on mobile, install as a PWA, see their week, view payslips, acknowledge.

### New layout

- **`app/(employee)/layout.tsx`** — bottom nav, mobile-first, max-width container.
- **`app/manifest.ts`** (next-15 dynamic manifest) — PWA manifest with icons, theme color from `company.brandColorHex` setting, name from `company.name`, start URL `/home`.
- **`app/(employee)/sw.ts`** or **`public/sw.js`** — service worker. Offline shell only: cache the app chrome, fall back to a "you're offline" page when API requests fail. Don't cache employee data offline (privacy).

### New pages

- **`app/(employee)/home/page.tsx`** — REPLACE the Phase 0 placeholder.
  - "This week so far" card: hours, projected pay, days remaining.
  - Alerts list: missed-punch issues with "Fix this" CTA, time-off status updates.
  - Quick actions: "Report a missed punch", "Request time off".
- **`app/(employee)/time/page.tsx`** — calendar strip (this week + last 4), per-day card with in/out/hours, "edited" indicator, fix-request affordance.
- **`app/(employee)/time/[date]/page.tsx`** — day detail.
- **`app/(employee)/pay/page.tsx`** — list of past periods with state pill (Pending Review · Published · Acknowledged), newest first.
- **`app/(employee)/pay/[periodId]/page.tsx`** — full payslip viewer (iframe PDF + acknowledge button).
- **`app/(employee)/profile/page.tsx`** — view + edit. Sensitive fields (legal name, email) require admin approval (creates a request, admin reviews). Language toggle (en/es). Notification channel preferences. Password change. Sign out.

### New components

- **`components/employee/bottom-nav.tsx`** — Home, Time, Pay, Profile. Lucide icons. Active state indicated by accent color.
- **`components/employee/week-stats-card.tsx`** — hours + projected pay + days remaining.
- **`components/employee/alert-card.tsx`** — missed-punch alert with CTA.

### Auth flow

- Login page already exists. Add browser locale detection on `/login` to default `Accept-Language`.
- Employees with `Employee.email` get a corresponding `User` row with `role=EMPLOYEE` linked via `users.employee_id`. Phase 1's employee creation should already do this — if it doesn't, add it.
- Password reset for employees: deferred until email is enabled (admin can set a temp password from the employee detail page in Phase 1).

### i18n

- Wire `next-intl` for real this time. Locale resolution: `Employee.language` if signed in, else browser `Accept-Language`, else `en`.
- All Phase 4 strings translated to `es` in `messages/es.json`.

### Done when

- Employee can sign in on mobile, install as a PWA on iOS Safari and Android Chrome.
- Home tab shows this-week stats + alerts; quick actions navigate to the right places.
- Time tab shows calendar strip + day cards; day detail allows requesting a fix.
- Pay tab lists periods, opens the viewer, acknowledges with audit.
- Profile tab works for view + edit + language + password.
- Service worker provides an offline shell (not data caching).
- Spanish covers 100% of employee-facing strings (mark unsure phrases with `// TODO(es-review)`).
- `/api/health` still 200.

### Risks

- **PWA install on iOS.** Safari requires specific manifest fields (apple-touch-icon, status bar style). Test on a real iPhone; emulators lie.
- **Service worker scope.** Serve the SW at `/sw.js` from the same origin so it controls the whole app. Be careful with the `/api/auth/*` paths — don't intercept them.

---

## Phase 5 — Requests & notifications

> Goal: employees submit missed-punch fixes and time-off requests; admins approve; notifications fire on all the right events to all the right people, in-app and via push.

### New flows

- **Missed-punch request.** Employee opens `/home` → sees alert → taps "Fix this" → form pre-filled with what we know (date, expected times from shift defaults) → enters claimed in/out + reason → submits `MissedPunchRequest` (PENDING). Admin gets notified. Admin reviews → approve creates a `Punch` with `source=MISSED_PUNCH_APPROVED`, links the request, resolves the alert. Employee gets notified.
- **Time-off request.** Employee opens `/home` → "Request time off" → start/end date, type, reason → submits. Admin reviews → approve sets type-appropriate behavior; reject with note.

### New pages

- **`app/(employee)/home/missed-punch/[alertId]/page.tsx`** — fix request form.
- **`app/(employee)/home/time-off/new/page.tsx`** — request form.
- **`app/(employee)/profile/notifications/page.tsx`** — per-event-kind channel toggles for THIS user (overrides defaults from settings).
- **`app/(admin)/requests/page.tsx`** — two-tab interface (missed punches, time off). Inline approve/reject with note.

### Notification system

- **`lib/notifications/in-app.ts`** — write to `notifications` table.
- **`lib/notifications/push.ts`** — Web Push (PWA). Owner doesn't need email per §21 #2. Web Push uses VAPID keys; generate at install time (`deploy/lxc/install.sh` should generate them and add to `/etc/payroll/.env`).
- **`lib/notifications/router.ts`** — `getChannels(kind, recipient)` returns merged channels (defaults from `notifications` setting, overridden by per-user preferences). `dispatch(kind, recipient, payload)` writes one notification row per channel and fires push if applicable. Failures logged but never block the originating action.
- **`lib/jobs/handlers/notifications-dispatch.ts`** — pg-boss handler. Originating actions enqueue notifications rather than dispatching synchronously (so the action returns fast).

### Push subscription flow

- On `/profile/notifications`, prompt for permission, register service worker subscription, save endpoint to `notifications.push_subscriptions` table.
- New table:
  ```
  CREATE TABLE push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX push_subs_endpoint_unique ON push_subscriptions (endpoint);
  ```

### Done when

- Full missed-punch flow works end-to-end: detection → in-app + push notification → fix request → admin approve → punch created → alert resolved → employee notified.
- Time-off flow works.
- The bell badge in the admin topbar shows unread count; click opens a dropdown of unread notifications.
- Per-user channel overrides work.
- VAPID keys auto-generated on first install.
- `/api/health` still 200.

### Risks

- **Web Push VAPID key persistence.** If `/etc/payroll/.env` is regenerated (e.g. accidental re-run of install.sh on an existing deploy), VAPID keys get rotated and existing subscriptions break. The installer should detect existing keys and preserve them; only regenerate if missing.
- **Notification storms.** A single PayrollRun publish fires N notifications (one per employee with a payslip). Batch them in the dispatcher; don't spam a single user.

---

## Phase 6 — Polish & reports

> Goal: Reports tab is live with charts; CSV exports work; Spanish translations cover everything; docs are complete; the demo seed looks polished.

### New pages

- **`app/(admin)/reports/page.tsx`** — Reports landing.
  - Tabs: YTD totals, hours-by-employee chart, payroll trends, period comparisons.
  - Charts via `recharts`.
  - Export buttons that generate CSV via `lib/reports/csv-export.ts`.

### New libs (`lib/reports/`)

- **`ytd.ts`** — `getYtd(year)` returns per-employee totals from `payslips` rows.
- **`csv-export.ts`** — generic CSV writer with header row, RFC 4180 quoting.
- **`hours-by-employee.ts`** — for charting.
- **`period-comparisons.ts`** — current period vs prior periods.

### Audit log viewer (full polish)

The Phase 1 audit page was minimal. Phase 6 adds:
- Filter by actor (search by email)
- Filter by target type
- Date range picker
- Action keyword search
- "Show before/after diff" inline expansion

### Spanish — full coverage

Audit every user-facing string against `messages/es.json`. Mark uncertain phrasings with `// TODO(es-review)` for the native-speaker pass. Cover all phases' strings.

### Documentation

Fill in the stubs:
- **`docs/ngteco-troubleshooting.md`** — full troubleshooting guide with screenshots of common NGTeco error states, selector update flow.
- **`docs/runbook.md`** — replace Phase 0 placeholders with real Sunday-night procedures, rollback steps, restore drills.
- **`docs/admin-onboarding.md`** (new) — owner's onboarding doc for admins they invite.
- **`docs/employee-onboarding.md`** (new) — first-time employee experience walkthrough.

### Demo seed (final polish)

- 24 employees with realistic photos (use placeholders that don't look like demoware — e.g. consistent abstract avatars).
- 16 weeks of historical data with realistic punch patterns (most employees Mon-Sat, 8h/day with some variance).
- Mix of payslip states across history (a few unacknowledged, most acknowledged).
- A handful of approved time-off requests in the calendar.
- A few historical missed-punch requests, all resolved.
- One open period with 2-3 unresolved alerts.

### Done when

- Reports renders with at least 4 charts (YTD totals, hours trends, payroll trends, period comparisons).
- CSV export works for: employees, payslips, punches, audit log, period totals.
- Spanish covers 100% of user-facing strings (no missing keys, no `// TODO(es-review)` left unreviewed by a native speaker — this last one is owner-coordinated).
- All four docs complete.
- Demo seed loads and the dashboard, employees, time, payroll, and reports tabs all show realistic data.
- `/api/health` still 200.

---

## Phase 7 — Future hooks (do NOT build)

Just leave the doors open in Phase 1-6 for these. Don't spend time on them:

- **Kiosk PIN punch mode.** Employees have `pinCodeHash` already; an iPad at the door could auth via PIN and create punches with `source=KIOSK`. Add the `KIOSK` enum value when this lands; don't add it now.
- **Direct timeclock webhook.** If NGTeco ever opens an API, the scraper becomes a webhook receiver. Keep `lib/ngteco/import.ts` independent of the scraper code path so a webhook can call it.
- **Direct deposit / ACH.** Out of scope for this rebuild. Don't model anything that suggests it.

---

## After Phase 6 — merge to main

Once Phase 6 is signed off by the owner, merge `rebuild/foundation` to `main` and switch the LX120 deploy to track `main`:

```bash
# On the LXC
sudo sed -i 's|rebuild/foundation|main|' /etc/systemd/system/payroll-deploy.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart payroll-deploy.service
```

Tag the merge commit `v1.0.0`. Update README.

---

## Universal definition of done (per phase)

A phase is shippable when:

1. All listed features work end-to-end in a fresh `docker compose up`.
2. Typecheck passes with zero errors and zero `// @ts-expect-error`.
3. Vitest passes with no skipped tests; coverage gates green.
4. Migrations are reversible (`drizzle-kit drop` cleanly).
5. Demo seed loads and the affected screens have realistic data.
6. README updated with the new phase status.
7. `/api/health` on LX120 returns 200 with all checks green.
8. New telemetry signals are visible in the console (or OTLP if configured).
9. The phase is committed and pushed to `rebuild/foundation`.

---

## Per-phase commit hygiene

- One topical commit per concern (queries, components, jobs, tests, docs). Don't make 50-file mega-commits.
- Conventional Commit prefixes: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `db` (for migrations).
- The phase wrap-up commit should be `feat(phase-N): ship` and is the one that gets tagged.
- After each phase: `git tag phase-N-done && git push --tags`.

---

## Per-phase deploy

After the wrap-up commit lands on `rebuild/foundation`, the LX120 systemd timer pulls it within 60 seconds and rebuilds. Verify by polling `/api/health` until 200, then run a quick smoke test:

```bash
LXC_IP=$(ssh root@192.168.1.190 'pct exec 120 -- hostname -I | awk "{print \$1}"' | tr -d '\r\n')
for i in $(seq 1 24); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://${LXC_IP}:3000/api/health")
  echo "[$i/24] /api/health → $status"
  [ "$status" = "200" ] && break
  sleep 5
done
curl -s "http://${LXC_IP}:3000/api/health" | jq
```

If green, post a brief progress message in chat and proceed to the next phase. If red, stop, surface logs, fix.
