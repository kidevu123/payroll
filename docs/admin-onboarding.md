# Admin onboarding

You're a new admin on this payroll instance. The owner invited you. This is what you can do, what you can't, and the small set of things you should learn first.

## Sign in

Use the email + password the owner gave you. First login may prompt you to set a new password.

## What you can do

- Manage employees: add new hires, edit their profile, archive (soft-delete; nothing gets removed from history).
- Manage shifts: rename, reorder, archive. The "Day" shift seeds by default.
- Edit punches: every change requires a reason; the original timestamps are preserved on the row and visible to the audit log.
- Lock + unlock pay periods. Unlocking a paid period is forbidden.
- Approve / reject employee requests (missed-punch fixes, time off).
- Run the Sunday close: the dashboard shows the active run and walks you through it.
- Configure NGTeco connection (Settings → NGTeco). Credentials are encrypted at rest with AES-GCM.

## What you can't do

- Read the audit log. That's owner-only.
- Reconfigure security thresholds (admin 2FA toggle, login rate limits, session timeout). Owner-only.
- Delete data. There is no delete; everything soft-deletes.

## The Sunday close

Walk-through the first time:

1. Open the dashboard. The big card in the middle is the current payroll run.
2. Card states you'll see, from least to most done:
   - **Scheduled** — cron will fire soon. Nothing to do.
   - **Ingesting** — Playwright is pulling punches from NGTeco. ~30s.
   - **Awaiting employee fixes** — the system found gaps. Affected employees got pinged. There's a deadline (usually Monday 7pm); the run auto-advances when it expires.
   - **Awaiting admin review** — the only state that needs you. Click **Open run for review**, scan the per-employee table (hours, gross, alert pills), click **Approve**.
   - **Approved** → **Published** — payslip PDFs are generating. Wait ~10s.
3. After publish, you can browse `/payroll/run/<id>` for the per-employee breakdown, or open `/api/payslips/period/<periodId>/signature` for the signed paper report.

If anything is off — missing employee, wrong rate, weird hours — fix it from the **Edit punches** screen at `/time/<periodId>/<date>/<employeeId>`. Editing a published period requires unlocking first.

## Settings you'll touch

- **Pay periods** — length + start day. Editing the anchor is locked once any period exists.
- **Pay rules** — rounding rule, decimal places, optional overtime. Changes apply to future periods only; existing payslips are immutable.
- **Shifts** — CRUD + reorder. Assignment is owner-defined, not an enum.
- **NGTeco** — portal URL, credentials (write-only), location ID, headless toggle.

## Day-to-day

Three things land on your dashboard between Sunday closes:

- **Pending requests** — fix-punch + time-off submissions. Inline approve/reject.
- **NGTeco run history** — the most recent ingest. If a non-Sunday import fails, the bell badge in the topbar gets a red dot.
- **Recent runs** — last three payroll runs with their state pills.

## When you can't tell what to do

Hit `/help` (Phase 6.1; not yet implemented) or read the runbook at `docs/runbook.md` on the LXC. The owner has a CLI password reset and audit log access if you get truly stuck.
