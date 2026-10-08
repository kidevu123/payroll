# Payroll

A self-hosted, single-tenant payroll and employee operations platform for a small manufacturing and distribution business. Gross pay only. The owner runs payroll in a few minutes a week; the system does the rest: it pulls punches from the NGTeco timeclock on a schedule, detects problems, notifies the right person, generates payslips and waits for the owner to approve.

This README is the operational overview. Related reading:

| Document | What it covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System diagram, the weekly payroll run, how the code is layered |
| [`docs/spec.md`](docs/spec.md) | The original design contract |
| [`docs/runbook.md`](docs/runbook.md) | Day-to-day operations, common issues, rollback, restore |
| [`docs/deploy-proxmox.md`](docs/deploy-proxmox.md) | Installing on a Proxmox LXC |
| [`CLAUDE.md`](CLAUDE.md) | The running project log: every significant change, decision and known gap |

## What it does

**For the office (admin dashboard)**

- Time grid per pay period, with a day editor for fixing or adding punches, and back pay for a shift reported after its week was paid.
- Pay periods on multiple schedules (weekly, biweekly, semi-monthly, monthly), each with its own run. Employees are paid only on the schedule they are assigned to.
- Payroll run workflow: ingest punches, detect exceptions, give employees a fix window, review, approve, publish payslips.
- Reports: year summary, pay runs ledger, per-employee and per-schedule tables, CSV exports.
- Requests inbox for missed-punch fixes and time off, including filing time off on an employee's behalf.
- Cash drawer ledger with petty-cash receipts, and an accountant role scoped to it.
- Salaried staff: paystub uploads per period, with the net amount read from the PDF.
- Calendar (time off, holidays, birthdays), announcements with saved templates, audit log with before/after diffs.
- Settings for everything company-specific: pay rules, schedules, shifts, holidays, branding, roles and permissions, automation, NGTeco, Zoho, Google Calendar, single sign-on.

**For employees (installable phone app, English and Spanish)**

- Home, timesheet, pay, calendar and profile.
- Report a missed punch with a time-only picker; request time off.
- View payslips in the app, confirm hours, or report a problem.
- Choose a payout preference (cash or Zelle). This is display-only and does not affect payroll math.

**For the warehouse (shared tablet kiosk)**

- PIN sign-in by clock ID, with an automatic sign-out after 45 seconds idle.
- Hours, pay, fix a punch, request time off.
- Sign your own payslip on the tablet. A payday mode, unlocked by a one-time office code, lets everyone sign in turn without seeing anyone else's pay.

**Integrations**

- **NGTeco** timeclock: hourly punch poll over its REST API, with a headless-browser scraper kept as a fallback.
- **Zoho Books**: the office pushes payroll expenses from the Reports page, booked per employee where configured.
- **Authentik**: single sign-on with automatic account provisioning.
- **Google Calendar**: approved time off as calendar events.
- **Web Push** notifications, plus in-app notifications. Email is disabled.
- **MCP server**: lets an AI agent read payroll data and perform a limited set of actions (see [`mcp-server/README.md`](mcp-server/README.md)).

## Tech stack

Next.js 15 (App Router), React 19, TypeScript strict. Postgres 16 through Drizzle. Auth.js v5 with email and password (Argon2id). Tailwind v4 with shadcn primitives. `pg-boss` for background jobs (no Redis). Playwright for the NGTeco fallback scraper. `@react-pdf/renderer` for PDFs. `next-intl` for English and Spanish. OpenTelemetry with a Prometheus metrics endpoint. One multi-stage Dockerfile, deployed with Docker Compose to a Proxmox LXC.

## Local development

```bash
nvm use                                   # .nvmrc: Node 22.11 (the production image runs Node 24)
npm install
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 48)" >> .env
echo "NGTECO_VAULT_KEY=$(openssl rand -base64 32)" >> .env

docker compose up -d db                   # Postgres only
npm run db:migrate
npm run seed                              # or: npm run seed:demo
npm run dev                               # http://localhost:3000
```

The first visit goes to `/setup` to create the owner account.

Two things to know:

- **Empty databases.** `npm run db:migrate` cannot build a database from empty in one pass (Postgres rejects using a new enum value in the same transaction that adds it). For a scratch database, apply the files in `drizzle/` one at a time with `psql`, in order. Production is unaffected because it applied them incrementally.
- **After changing the schema,** run `npm run db:generate` and commit the generated migration.

## Checks

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # next lint
npx vitest run           # unit tests
npx next build && npm run golden:check   # rendered pages and PDFs against pinned output
```

- **Unit tests** cover the rules in `lib/`. `npm test` also runs them but adds coverage thresholds that currently fail on `lib/payroll` even when every test passes; use `npx vitest run` for a plain pass or fail.
- **Golden check** renders 32 pages and 4 PDFs from the built app against a scratch database with a frozen clock, and compares them byte for byte with `tests/golden/`. It is the safety net for refactors. Setup is in [`scripts/golden/README.md`](scripts/golden/README.md). A pin changes only by a deliberate decision.
- **Deploy tooling tests** are plain bash: `bash deploy/test/payroll-deploy.test.sh` and `bash deploy/test/verify-image.test.sh`. Run them after touching the deploy unit or the image check.

## Deploy

Production runs in a Proxmox LXC and deploys from the `main` branch.

```bash
git push origin main      # live within about a minute, plus build time
./deploy.sh               # or: push, deploy now, and verify health and the running commit
```

A systemd timer in the container checks `main` every 60 seconds and rebuilds only when the commit changed. Each rebuild keeps the outgoing image as `payroll-app:previous` for rollback, and a failed build is recorded so it is not retried in a loop.

After a deploy, on the server:

```bash
cd /opt/payroll
bash deploy/verify-image.sh 2300    # 12 checks on the live container
bash scripts/smoke.sh               # every route answers
```

Things to keep in mind:

- **A deploy restarts the app.** The punch poll runs at the top of every hour, so avoid deploying then.
- **A cold build needs about 10 GB of free disk.** Check `df -h /` first.
- **Back up the database before a deploy that includes a migration.**

Installation, sizing and backups are in [`docs/deploy-proxmox.md`](docs/deploy-proxmox.md); rollback and recovery are in [`docs/runbook.md`](docs/runbook.md).

## Project layout

```
/app
  /(admin)        admin dashboard: time, payroll, reports, requests, employees, settings, ...
  /(employee)/me  employee phone app
  /(auth)         login and first-run setup
  /kiosk          shared-tablet kiosk and payday signing
  /api            health, auth, PDFs, push, integrations
/components
  /ui             shared primitives (buttons, cards, KPI card, inputs)
  /domain         shared app pieces (status chips, money, PDF links, payslip card)
  /time, /reports, /payroll, /calendar, /dashboard, /admin, /employee
/lib
  /db             Drizzle schema, queries, audit
  /payroll        pay computation and payroll rules
  /time-grid, /time, /time-off, /punches, /missed-punch, /reports, /salaried
  /pdf            PDF documents and their builders
  /ngteco         timeclock API client, scraper, importer
  /jobs           pg-boss queues and handlers
  /settings       typed settings and their schemas
  /crypto         AES-GCM vault for stored secrets
  /authentik, /zoho, /google, /notifications, /kiosk, /payslips
/messages         translations (en, es)
/drizzle          generated SQL migrations
/scripts          migrate, seed, repair tools, golden harness, smoke test
/deploy           installer, systemd units, image check, their tests
/mcp-server       MCP server for AI agents
/tests/golden     pinned pages and PDF fingerprints
/docs             architecture, spec, runbook, guides
```

The rule the code follows: **pages fetch data, call `lib/`, and render components. Rules and maths live in `lib/` with tests.** See [`docs/architecture.md`](docs/architecture.md).

## Conventions

- **Money is integer cents.** `formatMoney(cents)` is the only place cents become dollars for display; a test enforces it.
- **Times are `timestamptz`.** Display uses the company timezone, which is a setting.
- **Server actions are the API.** They live in `actions.ts` next to their page, start with `"use server"`, and validate input with Zod.
- **Authorization at the action layer,** not only in middleware: `requireAdmin()` / `requireOwner()` from `lib/auth-guards`.
- **Every mutation writes an audit row** in the same transaction.
- **Soft-delete only.** Nothing leaves the database.
- **No emoji** anywhere: UI, PDFs, notifications, commit messages.
- **Settings are levers.** Anything plausibly company-specific is configurable from Settings, not hardcoded.

## Operations at a glance

- **Health:** `GET /api/health` returns `{ status: "ok", checks: { app, db, boss } }`.
- **Logs:** structured JSON to stdout: `docker compose logs -f app`.
- **Metrics:** Prometheus endpoint on port 9464.
- **Backups:** a daily database dump under `data/backups/`, pruned after 30 days. Restore steps are in the runbook.

## License

Proprietary; internal use only.
