# Breaking up the giant files — design

Date: 2026-10-07
Status: awaiting review
Author: covering developer, with Claude
Refactor piece 3 of 4 (after the container diet and the dependency cleanup).

## Goal

Make the three largest admin pages safe to change and easy to build on,
without changing anything a user sees, by (1) pinning exactly what each page
renders, (2) moving their pure logic into tested `lib/` modules, and
(3) splitting their render into focused components.

Success means, for each page in scope:

- The pinned output is identical before and after, byte for byte.
- Every piece of logic that moved to `lib/` has unit tests, and the
  existing 100% coverage gates on `lib/payroll` still hold.
- The page file is under 300 lines and does only three things: fetch,
  call `lib/`, render components.
- The helpers that today exist as five private copies exist once.
- Typecheck, lint and the full suite pass; production passes
  `deploy/verify-image.sh` and `scripts/smoke.sh` after each deploy.

Nothing visual, no wording, no behaviour changes. If a golden ever has to
change to make a step pass, that step stops and the change is brought to
the user as a decision.

## Scope

In, in this order (each shipped on its own):

1. Shared date/time helpers (`lib/time/format.ts`).
2. `app/(admin)/time/page.tsx` (1,663 lines).
3. `app/(admin)/reports/reports-table.tsx` (1,663 lines).
4. `app/(admin)/payroll/[periodId]/page.tsx` (1,299 lines).

Out:

- `lib/ngteco/scraper.ts`. User decision: it drives the vendor's website,
  only production has credentials to test it, and nobody builds on it.
- `lib/db/schema.ts`: one responsibility, one file; that is how Drizzle
  wants it.
- The next tier (`calendar/page.tsx`, `run-payroll/upload/upload-form.tsx`,
  `time/.../punch-editor.tsx`, `salaried-upload-slot.tsx`): same recipe,
  later batch.
- The dashboard's inline `style={{}}` blocks, the 41 unused exports knip
  reports (several disappear as a side effect; the rest wait), and any
  visual, copy or behaviour change.

## Part 1: the pin (golden DOM)

The pages are async server components that read the database and the
session, so a unit test cannot call them. The pin is black-box instead.

**Harness:** `scripts/golden/` with two npm scripts.

- `npm run golden:record` builds the app (`next build`), starts it in
  production mode (`next start -p 3111`) against the local scratch database
  `payroll_mobile_ui` (created during the mobile pass: 24 demo employees,
  six pay periods, the `owner@example.com` / `marcus@example.com` logins),
  fetches every route in the list below as the owner and as the employee,
  normalizes the HTML, and writes `tests/golden/<role>/<route>.html`.
- `npm run golden:check` does the same and diffs against the stored files.
  Any difference fails with a unified diff.

**Frozen clock.** The demo data is relative to the day it was seeded, so
the server runs with `NODE_OPTIONS=--require ./scripts/golden/fixed-clock.cjs`
and `GOLDEN_NOW=2026-10-06T18:00:00Z` (the seed day, inside the open weekly
period). The module replaces `Date.now()` and the no-argument `Date`
constructor with the fixed instant and leaves `new Date(value)` alone.
Without it the goldens drift every day. `TZ=UTC` is set as well so the
host's zone cannot leak in; the app renders in `company.timezone` anyway.

**Normalization**, applied to both sides before comparing:

- `<script>` elements removed. The RSC payload inside them names modules
  and components, which a split changes by design; the DOM it hydrates to
  does not.
- `/_next/static/<build-id>/` and `-<hash>.js|css` content hashes replaced
  by `HASH`.
- The footer's commit SHA and server-time line replaced by `SHA` / `TIME`.
- Nothing else. UUIDs stay: the scratch database is not reseeded during
  this piece, so they are stable. Reseeding it invalidates the goldens
  (re-record, review the diff, commit).

**Routes** (owner unless marked):

| Route | Covers |
|---|---|
| `/time`, `/time?schedule=weekly`, `/time?schedule=monthly`, `/time?schedule=salaried`, `/time?day=2026-10-05` | time page: all tabs, the mobile day selector, the monthly strip |
| `/time?period=<id of the most recent LOCKED weekly period>` | past-period navigation and the Locked badge |
| `/reports`, `/reports?year=2026`, `/reports?year=2025`, `/reports?tab=employees`, `/reports?tab=schedules`, `/reports?tab=methods`, `/reports?schedule=weekly`, `/reports?schedule=monthly` | reports table: every tab, the schedule filter, an empty year, pagination footer. The status / payment / search / sort filters and the pager are client state, so the golden captures their server-rendered default; interaction is covered by the smoke script and the manual pass |
| `/payroll/<LOCKED weekly id>`, `/payroll/<OPEN weekly id>`, `/payroll/<monthly id>` | period page: locked with payslips, open, non-weekly day count |
| `/payroll` | the list, which links to the period page (regression guard only) |
| employee: `/me/home`, `/me/time`, `/me/pay` | consumers of the shared date helpers |

Ids are resolved by SQL at run time and written into the golden filename
as a stable label (`payroll-locked-weekly.html`), never as the UUID.

Prerequisite step before any extraction: bring the scratch database up to
the states the pages branch on, record the goldens from the current code,
and commit them. They are the test that every later step runs first.

The scratch database today has 24 employees and six periods but no payroll
runs, no payslips and no payment methods, so three branches would be
untested. Step 0 therefore, before recording: publishes the most recent
LOCKED weekly period through the app (as in the sandbox: Payroll -> period
-> Publish; this writes 22 payslips through the real job), marks one other
LOCKED period PAID by cash via SQL (`update pay_periods set state='PAID',
payment_method='CASH', paid_at=now() where id=...`), and sets one payslip
`acknowledged_at` and one `dispute_reason` by SQL so the sign-off buckets
render non-empty. Each SQL statement is kept in `scripts/golden/README.md`
so the state is reproducible.

## Part 2: what moves to `lib/` (each with unit tests, written first)

### `lib/time/format.ts`

One home for the helpers that exist as private copies today:

| Helper | Copies today | Note |
|---|---|---|
| `fmtTime(date, tz, locale)` | 4 (`me/time`, `me/time/[date]`, `me/pay/[periodId]`, `lib/pdf/admin-report.tsx`) | locale-aware hour:minute |
| `dayKey(date, tz)` | 5 | `companyDayIso` already exists in `lib/time/company-day.ts`; the copies become calls to it |
| `formatDay(iso-or-date, tz)` | 3 (`detect-exceptions`, `period-boundaries`, `punch-row`) | weekday + month + day |
| `todayInTimezone(tz)` | 3 (`time/page`, `period-rollover`, `payroll-run-tick`) | two of these decide when payroll runs |
| `eachDay(startIso, endIso)` | 2 (`time/page`, `detect-exceptions`) | |
| `formatTimeShort` | 1, in `lib/utils.ts` | moves here; `lib/utils.ts` re-exports it so no import breaks |

Method per helper: write a test per existing copy asserting that copy's
current output on fixed inputs (including the ones that differ: `en-US`
vs the caller's locale, UTC vs company zone, `Date` vs ISO string
inputs). Then write the single implementation that passes all of them,
and point every caller at it. The three copies in payroll job handlers
are swapped last and separately, with their own commit, because they
decide when money moves.

### `lib/time-grid/`

The time page's logic, today inline in `page.tsx`:

- `period-select.ts`: `pickPeriodForTab`, `nextWindowAfter`,
  `findAdjacentPeriods`, `ensureCadencePeriodForToday`. These read the
  database, so they move to `lib/db/queries/time-grid.ts` with the
  selection *rules* (the "if last week is locked, move on" priority list,
  `nextWindowAfter`'s weekly/biweekly/monthly arithmetic) factored into
  pure functions in `lib/time-grid/period-select.ts` that the query
  module calls. The pure part gets the unit tests; the query wrapper is
  thin.
- `cell-state.ts`: `CellState`, `cellFor` (the complete / incomplete /
  missed / time-off / future / inactive rules), `timeOffStateFor`,
  `timeOffLabel`, `cellPillClasses`, `legendDotClass`, `MOBILE_STATUS`,
  `cellAriaLabel`. Tests enumerate every state and the precedence between
  them (inactive beats everything; time off beats missed; future beats
  missed).
- `kpis.ts`: total minutes, per-employee minutes, regular vs overtime
  split at 40h, overtime risk at 87.5%, clocked-in-today count and
  percentage, open shifts, unpaired count, today's summary buckets,
  hours-by-day sparkline input, `fmtHm`, `issuesByDay`, `mobileSummary`.
  Tests use a small fixed punch set and assert each figure.

### `lib/reports/table-model.ts`

From `reports-table.tsx`: `groupByPeriod`, `groupByMonth`, `periodNet`,
`periodGross`, `monthNet`, `monthGross`, `groupState`, `groupMethod`,
`matchesFilters`, `pageNumbers`, `monthLabel`, `monthKey`. Tests use a
fixed report list covering: a period with a run and W2 docs, a W2-only
period, a cash-paid period, a straddling month, and every filter
combination. `lib/reports/year-summary.ts` already exists and is tested;
the new module follows its style.

### `lib/payroll/period-view.ts`

From the period page: `formatHm`, `formatDayLabel`, `rateLabel`,
`formatShortDate`, `periodDayCount`, `issueLabel`, and the
acknowledgement bucket computation (signed / acknowledged-not-signed /
pending / disputed). Note the 100% coverage gate on `lib/payroll/**`
applies to this file.

## Part 3: what splits into components

Pure presentation, props in, markup out; no data access inside.

- `components/time/`: `day-strip.tsx`, `attendance-list.tsx`,
  `punch-cell.tsx`, `kpi-cards.tsx`, `legend.tsx`, and the rail cards
  (`today-summary-card.tsx`, `exceptions-queue-card.tsx`,
  `labor-hours-card.tsx`, `insight-card.tsx`; `MissedPunchRailCard`
  already lives in `components/domain`).
- `components/reports/table/`: `filter-bar.tsx`, `pager.tsx`,
  `month-card.tsx`, `period-line.tsx`, `cells.tsx` (status, payment
  method, visibility, Zoho badges), `row-actions.tsx`,
  `row-overflow-menu.tsx`. `reports-table.tsx` keeps `ReportsTable` as
  the orchestrator.
- `components/payroll/period/`: `header-meta.tsx`, `action-bar.tsx`,
  `documents-card.tsx`, `sign-off-card.tsx`, `employee-totals.tsx`
  (with `PunchSubTable`), `w2-section.tsx`.

The page files end as fetch → `lib/` → components, under 300 lines.
Component files aim for under 250 lines; a file over that is split by
responsibility, not by line count.

## Order and shipping

| Step | Ships | Gate |
|---|---|---|
| 0 | golden harness + recorded goldens | goldens committed; `golden:check` passes on unchanged code |
| 1 | `lib/time/format.ts` + all callers (job handlers last, own commit) | golden identical; new unit tests; suite green |
| 2 | time page: extract `lib/time-grid/*`, then split components | golden identical after extract, again after split |
| 3 | reports table: extract `table-model.ts`, then split | same |
| 4 | period page: extract `period-view.ts`, then split | same |

Each step is its own deploy to LX120 (cached build, a few minutes), with
`previous` available for rollback. Between steps the branch is always
deployable.

## Verification per step

1. `npm run golden:check`: identical.
2. `npm run typecheck`, `npm run lint`, `npx vitest run --coverage`
   (the `lib/payroll` and `lib/punches/parser.ts` 100% gates included).
3. Deploy; on LX120 `bash deploy/verify-image.sh 2300` and
   `bash scripts/smoke.sh http://localhost:3000` (anonymous mode), then
   the owner-side pages opened once by hand.

## Risks

| Risk | Handling |
|---|---|
| A helper's copies differ subtly and the consolidation changes one caller | per-copy tests written first, from the current output; the job-handler swaps are separate commits |
| The golden normalization hides a real change | normalization is limited to scripts, hashes, SHA and time; everything else, including whitespace, must match |
| The goldens pass but a client-only behaviour breaks (a menu, a filter select) | client components move but are not rewritten; the smoke script and a manual pass cover interaction; no client logic is extracted in this piece |
| Demo data lacks a state a page branches on (e.g. a disputed payslip, a cash-paid period) | the route list is checked against each page's branches before recording; missing states are added to the scratch database by SQL and noted in the harness README so the goldens are reproducible |
| A step grows past a day of work | a step is split at a commit that leaves the golden identical; nothing is left half-moved |

## Out of scope (repeated so no one "helpfully" does it)

Scraper. Schema. Dashboard inline styles. Visual or copy changes.
Pagination for `/punches`. The unused exports beyond those that vanish on
their own.
