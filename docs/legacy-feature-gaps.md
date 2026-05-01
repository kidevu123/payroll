# Legacy Flask app → v1.2 feature gap inventory

Audit of `/data/legacy/simple_app.py` (~6000 LOC) against the current Next.js
app. Goal: keep the new UI + employee portal but recover the operational
nuances the owner relied on. Already-done items are listed for completeness.

## Completed in v1.2 (no further work)

- `/reports` legacy-style table (Week | Amount | Created by | Posted | Actions)
- Per-period admin detail (employee totals + chronological punches)
- Pay schedules (Weekly + Semi-Monthly) with cron picker
- Branding + PWA icon generation
- Zoho integration (per-org OAuth, idempotent push, env bootstrap)
- CSV upload (parser now NGTeco-shaped after the v1.2.1 fix)
- Employee portal: /me/home, /me/time, /me/pay, /me/profile
- Audit log on every mutation
- Push notifications + in-app inbox (Phase 5)
- Mobile drawer + language switcher (v1.2.1)

## MUST-HAVE — workflow blockers still missing

### 1. Manual punch edit on the run review page
Legacy `/fix_times` (lines 4700-4900) lets the admin correct individual
clock_in/out values inline before approve. New app shows punches but
they're read-only. Without this, an admin who spots a typo has to:
re-export from NGTeco → re-upload → re-validate. Owner needs in-place
edit + an audit row capturing the original.

### 2. CSV upload validation gate (before commit)
Legacy splits the upload into `/validate` → `/fix_missing_times` →
`/confirm_employees` → `/process`. New app does parse-and-commit in one
shot. Owner needs:
- Show every row's parse status BEFORE inserting into `punches`
- Highlight rows with missing in/out
- Optional "suggested times" pulled from peer employees on the same date
  (legacy lines 4563-4734)
- Checkbox to include/exclude individual employees from this run
- "Commit" button at the end; nothing lands in `punches` until clicked

### 3. Approve / deny missed-punch requests + time-off requests
`/requests` page exists but the approve/deny flow doesn't render the
inline action buttons next to each pending row. Legacy
`/time_off_requests` (lines 8039-8150) shows both queues on one screen
with single-click approve/deny.

### 4. Pay rate management UI
Right now rates live on the Employee detail page (one rate per employee
via the rate-history table). Legacy `/manage_rates` (lines 2690-2840)
gives a single screen with: filter by shift, sort by name/rate/shift,
inline edit, delete, bulk CSV import (legacy line 2794). Worth porting
because it's the screen owner uses to onboard a new hire.

### 5. Bulk-create employee portal accounts
Legacy `/bulk_create_employee_users` (lines 9146-9225) scans
pay_rates.json and creates an `emp_<id>` user with a default password
for every rate row that lacks one. New app makes the admin invite each
employee one-by-one from the Account section. Add a "Send portal
invites to everyone without an account" bulk action.

### 6. Temp-worker quick-select on the manual entry form
Legacy `/temp_workers/add` (line 8490) has a dropdown of existing temp
workers that pre-fills name + rate when picked. New app makes you
re-type. The shape is already in `temp_workers.json`; surface a list.

### 7. Re-push a saved report to Zoho
Legacy `/zoho/push_saved_report` (lines 8350-8490) lets the admin
re-push an archived report (e.g. after the first push errored). The
v1.2 push action is idempotent on success but doesn't expose a "force
re-push" path. Add a `Re-push` button on the Reports table when the
prior push has status='ERROR'.

### 8. Suggested clock-in / clock-out times for missing punches
Legacy `/fix_missing_times` (lines 4563-4734) computes the average /
most-common clock_in for the same date across all employees and pre-
fills the input. Saves typing for normal "everyone clocked in around
6am" days. Useful even with item 2 above.

### 9. Per-employee payslip PDF in the legacy "card" layout
Legacy generates `payslips_for_cutting_<date>.xlsx` (lines 3897-4472):
one card per employee with daily breakdown ready to cut and hand out.
v1.2 has a per-employee PDF but it's a single-page layout. Owner uses
the cards as physical pay stubs.

## NICE-TO-HAVE — quality of life

### 10. Report list metadata cache
Legacy line 7023 caches the report list for 5 min. v1.2 reads
`payroll_runs` on every render. With 60+ rows and the joins it's still
fast, but worth caching when the list grows.

### 11. Report week label
Legacy shows e.g. "Jan 4 – Jan 10, 2025" instead of raw ISO dates. v1.2
already formats the Reports table this way; check the per-period detail
header.

### 12. Status badges on requests
Legacy uses Pending / Approved / Denied colored chips. v1.2's StatusPill
component supports this — just ensure /requests uses it.

### 13. CSV-import fallback when columns are missing
Legacy: if uploaded CSV is missing required columns, fall back to a
"simple" mode (lines 4498-4530). v1.2 either fails the row or whole
file. Surface a friendly "Your CSV is missing X. Re-export with the
NGTeco preset, or use this template." link.

### 14. Async progress for long NGTeco fetches
Legacy `/fetch_timecard/progress/<job_id>` (lines 9334-9400). v1.2's
Run Now button polls every 2s but doesn't show fine-grained progress
(login / page load / scrape). Add stages.

## SKIP — intentional v1.2 simplifications

- **XLSX report files**: replaced by PDFs + the database. Legacy XLSX
  files remain accessible via the Download button on the Reports table
  for historical runs.
- **Plaintext password warnings**: v1.2 enforces Argon2id at setup; no
  legacy migration path needed.
- **Three flavors of consolidated Excel**: collapsed into a single
  `payroll_runs` row with computed payslips. The "card" sheet is item 9.
- **Selenium NGTeco scraper running on cron inside the app process**:
  the new app uses Playwright in a worker queue (pg-boss). Cleaner
  failure isolation.

---

## Suggested triage order

For the next milestone (call it v1.2.2 → v1.3):

1. **Item 2** (CSV validation gate) — fixes the "$0 totals" surprise from
   this week's upload by forcing review before commit.
2. **Item 3** (request approve/deny inline) — owner already has data
   waiting in the table.
3. **Item 1** (manual punch edit) — closes the loop on item 2.
4. **Item 4** (pay rate manager) — onboarding friction.
5. **Item 5** (bulk-invite employee accounts) — needed before
   distributing the PWA.
6. Items 6 / 8 / 9 / 10 — polish in priority order.

Items 11-14 — opportunistic, slot in alongside related work.
