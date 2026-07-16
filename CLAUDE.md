# Claude project briefing

This file is read automatically by Claude Code on session start. It exists so any future Claude (yours, mine, or someone else's) has the same context the original architect had — without re-reading the entire spec.

## What this repo is

A self-hosted, single-tenant payroll and employee operations platform for a small manufacturing/distribution business. The owner runs payroll in under five minutes a week. Everything else is automated. The system reaches into NGTeco (the existing timeclock vendor, no open API) on a schedule, pulls punches via a Playwright-driven scrape, detects problems, notifies the right person, generates payslips, and waits for the owner to tap one button.

The full design contract lives in `docs/spec.md`. Anything in this repo that diverges from that file is wrong. If reality forces a divergence, update the spec in the same commit.

## Tech stack (locked)

Next.js 15 (App Router) + React 19 + TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Postgres 16 via Drizzle. Auth.js v5 with email + password (Argon2id). Tailwind v4 + shadcn primitives copied in. `pg-boss` for jobs (no Redis). Playwright for the NGTeco scraper (Phase 2+). `@react-pdf/renderer` for payslips (Phase 3+). `next-intl` for i18n (en, es). OpenTelemetry, console exporter by default. Single multi-stage Dockerfile, deploys to a Proxmox LXC.

## File layout

```
/app
  /(employee)              # mobile PWA (Phase 4)
  /(admin)                 # admin dashboard
  /(auth)                  # login + first-run setup
  /api/health              # health probe
  /api/auth/[...nextauth]  # Auth.js handlers
/components
  /ui                      # shadcn primitives
  /admin                   # admin shell (sidebar, topbar)
/lib
  /db                      # Drizzle schema, queries, audit
  /settings                # typed Setting access + Zod schemas
  /jobs                    # pg-boss bootstrap
  /crypto                  # AES-GCM vault for stored secrets
  /auth.ts, auth-guards.ts # Auth.js setup + role helpers
  /telemetry.ts            # OTel + structured logger
  /utils.ts                # cn(), formatMoney(), formatHours()
/messages                  # next-intl translations
/drizzle                   # generated migrations (commit after `npm run db:generate`)
/scripts                   # migrate, seed (idempotent)
/deploy/lxc                # install.sh + systemd units for LX120
/docs                      # spec, deploy notes, runbook, i18n glossary, handoff
```

## Conventions (locked — do not relax these)

- **Money is integer cents.** Always. Never floats. `formatMoney(cents)` is the only place cents become dollars for display.
- **Times are `timestamptz`.** Display respects `company.timezone` (a Setting).
- **Server actions are the API.** They live in `actions.ts` next to their page, start with `"use server"`, validate input with Zod.
- **Authz at the action layer**, not just middleware. Use `requireAdmin()` / `requireOwner()` from `lib/auth-guards`.
- **Every mutation writes an audit row** before commit (`writeAudit()` in `lib/db/audit`).
- **No emoji.** Anywhere. Not in UI, not in PDFs, not in copy, not in commit messages, not in notification text. Use Lucide icons + colored chips + text labels.
- **Pure logic in `/lib/payroll` is fully unit-tested.** CI gates on coverage.
- **Soft-delete only.** Nothing leaves the database.
- **Settings are levers.** Every behavior listed in spec §16 is reachable from `/admin/settings` without touching code. If something is hardcoded that's plausibly company-specific, that's a bug.

## Current status

- **Phases 0 → 6: live on LX120.** Branch `rebuild/foundation` deployed via systemd timer. Healthy.
- **Phase 6 polish in flight.** Recent shipped work on top of the Phase 6 baseline: cash drawer + accountant role + payment-method tracking, cancellable time-off, role × surface matrix at every admin section, staff-login flow for non-employee roles, role-permissions matrix UI at `/settings/roles`, central punch admin, calendar polish + birthday display, employee onboarding PDF, NGTeco MUI login selector fixes, observability gauges/counters, employee profile photo upload, NGTeco poll resilience hardening (per-run hard timeouts that force-kill headless Chrome, `ngteco.chrome-reaper` orphan-browser backstop, a real Stop-poll cancel that kills the browser instead of just hiding the banner, and a fix for the `ngteco.import` standalone-bundle `ERR_MODULE_NOT_FOUND`), the design-audit UI sweep (geometry/a11y/typography passes plus a visual polish tier), and a three-tier responsive nav for the admin dark shell: mobile top bar + bottom tab bar below md, compact icon-only sidebar rail at md, full sidebar at lg (the mobile bars, `FeedbackLauncher` resting position, and `PollStatusBar` offset all hand off at md via props; the light-shell branch keeps its lg defaults), and a paid-history visibility fix: paystub docs attached to a pay period with NO payroll run now surface on /reports (previously, locking + marking such a period PAID hid the pay everywhere — /payroll filters PAID out by design and /reports only knew about runs and unattached Salaried-tab uploads). Follow-up unification: the period detail page's W2 section now also lists Salaried-tab uploads matching the period's date range, every paystub row there carries the shared Zoho push/re-push control (`components/domain/zoho-doc-status.tsx` — hourly requiresW2Upload employees never appear on /salaried, so the period page is the only Zoho surface for their docs), and Zoho pushes revalidate the owning period page. Also: shouldUseStoredPayrollTotals now requires stored payslips to exist — a PAID period with no run falls back to live punch totals instead of rendering "0 emp · $0.00". And a dark-shell readability fix: the `.dark` token block in `app/globals.css` now re-establishes `color: var(--color-text)` at the themed root. body resolves `color: var(--color-text)` while the light tokens are active, so descendants inside a `.dark` wrapper (the employee shell div, `#admin-root`) inherited the computed near-black — any element without an explicit text-* class (CardTitle dates, native date/time input values via preflight `color: inherit`) rendered invisible on the dark background (reported on the employee missed-punch form). Jul 2026 detail pass (owner-directed, free-reign UI sweep): (1) PWA print fix — PDF links opened inline with no share/print UI in the installed app; `components/domain/pdf-link.tsx` now intercepts clicks in standalone display-mode, fetches the PDF, and hands it to the native share sheet (AirPrint/Save to Files); wired into every payslip/cut-sheet/signature/report/paystub link (period page, reports table, salaried slots, employee pay pages, batch print list, `payslip-pdf-actions`). (2) /payroll periods list now names each period's lifecycle via `lib/payroll/period-status.ts` (RUNNING / NEEDS_PROCESSING / AWAITING_PAYMENT / UPCOMING, unit-tested) — rows sort by urgency, carry a phase chip + plain-English detail line ("day 3 of 7, ends Sun Jul 12"), and the left accent bar is phase-colored. (3) Global design-language shift per owner mocks: squarer radii (`--radius-card .625rem`, `--radius-input .5rem`, `--radius-chip .375rem`, `--radius-xl .875rem`), stronger dark borders (`--color-border #2e2e33`, dash borders 0.11/0.19), buttons share the input radius. (4) Sidebar/mobile-bell Notifications badge = announcements sent in last 7 days (`countRecentAnnouncements`). (5) /notifications rebuilt: PageHeader, overview tiles (sent this month / people reached / last sent), audience-typed icon plates, relative timestamps, chip meta row. (6) Reports KPI icon plates are accent-tinted. Follow-up: /reports reorganized to the owner's reference — header carries Time-off tally + an Export dropdown (CSV card removed), KPIs are now Gross / Net / Deductions / Employees paid (YTD), a filter bar (search + schedule/status/payment/sort selects, schedule navigates ?schedule= replacing the tabs strip) sits above the table, a column legend (Pay period | Schedule | Payment method | Status | Gross | Net) aligns with every period row via the shared TABLE_GRID lg grid, month headers show Total gross + Total net, rows carry a StatusCell (Completed/Locked/Open) + quiet PaymentMethodCell, and the rail summary gained Deductions / Pay runs / View-detailed-analytics. Owner follow-ups on that table: salaried W2 rows show their REAL pay schedule (query joins paySchedules through the doc's period; legacy Salaried-tab uploads infer cadence from the range via inferCadenceFromRange), the payment-method column is a colored chip again (amber cash / blue bank), salaried paystub rows read "Bank transfer" (owner: that's how they're paid) and the Payslips filter option was dropped, and month "Total gross" gets a * + tooltip when W2 net-only periods make it under-report. Performance pass (perceived + real): fonts self-hosted via next/font (the render-blocking Google Fonts stylesheet was the biggest cold-load cost), sw.js v3 caches /_next/static content-hashed assets cache-first (cold PWA opens skip re-downloading the bundle), loading.tsx added to EVERY employee tab (EmployeeRouteSkeleton in components/ui/skeleton.tsx) plus admin notifications/assistant, the employee shell gained top/left/right safe-area insets (Dynamic Island), AppTour's 60fps rAF measure loop now measures only on scroll/resize, fixed mobile bars dropped backdrop-blur-md to -sm, and the missed-punch report form no longer crushes two datetime inputs side-by-side on phones. Mobile polish batch applied: all audited tap targets carry 44px coarse-pointer hit areas (calendar pager, time-off cancel, notification delete, report-problem, tour/banner close, admin mobile-nav), employee-side text-[10px] bumped to 11px, off-token radii normalized (rounded-2xl/lg/bare rounded to card/input/chip tokens), bg-slate-400 fallback dot replaced with bg-text/30, notification rows gained min-w-0 truncation, net-pay heroes scale down a step on phones with wrap guards, and the payslip actions card dropped its pointless backdrop-blur. Calm pass (owner: current UI "yelling"; reference mock is calm): money/dates/hours render in the UI sans with tabular-nums instead of bold DM Mono (MoneyDisplay's monospace prop is a no-op, HoursDisplay and the .tabnum/.num CSS rule dropped the mono face, ~120 inline font-mono classes swept; mono remains only for real code artifacts — build sha, kbd hints, cron expressions, file paths, passwords, audit diffs, db tools), SchedulePill is a quiet neutral chip (cadence is context, not state — the status chip is the single colored element per row), PaymentMethodCell and the mobile PaymentChip went quiet gray icon+text (supersedes the earlier colored-chip ask), buttons and report dates demoted semibold to medium, row nets text-lg to text-base, and KPI figures font-bold to font-semibold. NGTeco poll cadence + settings honesty: the punch poll rides the browserless REST API by default (lib/jobs/handlers/punch-poll.ts, NGTECO_FORCE_SCRAPER=1 forces the old path), so the automatic poll is now HOURLY (owner directive) — schema default `0 * * * *` plus one-shot data migration drizzle/0040_ngteco_poll_hourly.sql aligning the stored automation setting (future /settings/automation edits are not overridden); /settings/ngteco and /settings/automation copy now says API-first with the headless toggle marked fallback-only. Note: legacy ngteco.import ("Run import now" on /settings/ngteco) still drives the browser scraper. Announcement templates (owner ask, per mock): `announcement_templates` table (migration 0041, seeded with 4 starters — Weekly reminder / Payroll ready / Policy update / Schedule change), list/create/soft-delete queries + audited actions, a Saved templates card on /notifications with Use (opens /notifications/new?template=<id> pre-filling title/body/link via ComposeAnnouncementForm's `initial` prop — audience is always re-chosen per send) and delete, plus /notifications/templates/new to create. Templates are compose starting points only; sent announcements never reference them. Not built from that mock: drafts, open-rate tracking (no read receipts exist — don't fake metrics), recent-recipients card. Petty-cash receipt uploads (owner ask, Jul 2026): cash_drawer_entries gained receipt_path (migration 0042); the Petty cash purchase form accepts an optional PDF/PNG/JPG/WEBP receipt (10MB cap), stored under the uploads dir via lib/cash-drawer/receipt-storage.ts; ledger notes cell links to the authed inline viewer at /cash-drawer/receipt/[entryId] (Owner/Admin/Accountant). A companion drawer app on the same host shares the receipts directory, so receipts recorded in either app render in both.
- **Bug-fix discipline.** Bugs uncovered while building are fixed in place per autonomous-mode rules. When a fix lands, update the relevant section here in the SAME commit — this file is the briefing every future session reads cold.

## What you (Claude Code) should do first

Read `docs/phases.md` and execute Phases 0.5 → 1 → 2 → 3 → 4 → 5 → 6 in order. Use the per-phase deploy + smoke-test loop (`docs/handoff.md`). Don't stop between phases except for the hard guardrails below.

## Autonomous mode (owner-authorized)

The owner has explicitly told Claude Code it can make changes without asking permission for routine work. Routine includes:

- Refactors, dep bumps, lint fixes, test additions, doc updates, file moves
- Bug fixes uncovered while building (fix in place, don't ask)
- Migrations that add tables/columns/indexes (ship them with the feature)
- Deploys to LX120 via push to `rebuild/foundation` (the systemd timer handles the rest)
- Per-phase smoke tests, commits, tags
- Reasonable design decisions where the spec is silent

Proceed autonomously through these. When a phase is done, post a short progress message in chat (not a prompt for permission) and start the next phase. The owner can intervene at any time.

## Hard guardrails (still mandatory — do NOT relax these)

- **Never force-push to `main`.** Until the owner explicitly merges `rebuild/foundation` to `main` (after Phase 6), `main` stays untouched.
- **Never run destructive Postgres operations.** No `docker compose down --volumes`, no `DROP DATABASE`, no migrations that drop user-data columns without an owner-approved data migration plan. Schema renames are fine if they preserve data.
- **Never bypass the vault for NGTeco credentials.** Plaintext is sealed via `lib/crypto/vault.ts` before writing; only `lib/ngteco/import.ts` decrypts. Don't log plaintext, don't put it in error messages.
- **Never paste real secrets into chat or commit them.** AUTH_SECRET, NGTECO_VAULT_KEY, Postgres password, VAPID keys live in `/etc/payroll/.env` on the LXC, mode 0600.
- **Never import legacy data without owner direction.** The owner said legacy reports/payslips need to remain accessible (§21 #8) but hasn't pointed at the source data yet. Ask before doing any import work in Phase 1+.
- **Never add features the spec doesn't ask for.** If something feels missing, post a single message in chat noting it as a "spec gap" and proceed without that feature. Don't build it.
- **Stop on a genuinely red gate.** If typecheck/lint/tests/health fails after a phase and a reasonable retry doesn't fix it, surface the failure with logs and stop. Don't paper over a failure to keep moving.
- **No emoji.** Anywhere. Including commit messages.

If you hit something that you genuinely can't decide between two reasonable options, pick one, document the choice in a "decision log" comment in the relevant file, and proceed. The owner can revisit later.

## Owner-confirmed answers (do not re-ask)

- Email channel: **disabled.** Push + in-app only. SMTP wiring stays in code but no SMTP tab in Settings.
- Admin 2FA: **off by default.** Toggle exists in Security settings.
- Single shift only, named "Day". No nightshift.
- Timezone: `America/New_York`.
- Payroll cron: `0 19 * * 0` (Sunday 7pm ET).
- Employee fix window: 24 hours (deadline = Monday 7pm).
- Spanish ships in v1, pre-populated from `docs/i18n-glossary.md`.
- Legacy data: existing reports and payslips need to remain accessible. Plan is to import legacy punches as `LOCKED`/`PAID` with `source=LEGACY_IMPORT`, and stash original PDFs at `/data/payslips/legacy/<period>/...`. Owner has not yet provided the legacy data location — ask before touching this.
- NGTeco: 2FA is off on the service account. Owner will paste credentials into the encrypted Settings UI when the app is up; do not request them in chat.

## Infrastructure

- GitHub repo: `kidevu123/payroll`. Owner has full access. Branch in flight: `rebuild/foundation`.
- Proxmox host: `root@192.168.1.190`. The payroll LXC is `120` (referred to as LX120). Enter with `pct enter 120`.
- Deploy mechanism: a systemd timer in the LXC runs `deploy/lxc/payroll-deploy.service` every 60 seconds. It does `git fetch && git reset --hard origin/<branch>` and rebuilds + recreates the docker compose stack only if HEAD changed. The branch it tracks lives in `/etc/systemd/system/payroll-deploy.service.d/override.conf` as `PAYROLL_BRANCH`.

## Common bash recipes

```bash
# Tail app logs on the LXC
ssh root@192.168.1.190 -t 'pct exec 120 -- bash -c "cd /opt/payroll && docker compose logs -f --tail=200 app"'

# See deploy timer status
ssh root@192.168.1.190 -t 'pct exec 120 -- systemctl status payroll-deploy.timer'

# Force a deploy now (instead of waiting for the next 60s tick)
ssh root@192.168.1.190 -t 'pct exec 120 -- systemctl start payroll-deploy.service'

# Health check from outside
curl -s http://<lxc-ip>:3000/api/health | jq
```
