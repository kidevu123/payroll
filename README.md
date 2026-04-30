# Payroll

Self-hosted payroll and employee operations platform. Single-tenant, single-purpose, gross-pay only. Designed so the owner runs payroll in under five minutes a week.

This is a ground-up rebuild — see `docs/spec.md` for the design contract. This README is operational.

## Status

**Phase 3 — Payroll run state machine + PDFs.** What ships on top of Phase 2:

- Pure missed-punch detection in `lib/payroll/detect-exceptions.ts` (NO_PUNCH / MISSING_OUT / MISSING_IN / SUSPICIOUS_DURATION) at 100% branch coverage.
- Run state machine: `transitionRun` with explicit legal-edge table per spec §6. Sunday cron → ingest → detect → AWAITING_EMPLOYEE_FIXES (or AWAITING_ADMIN_REVIEW) → APPROVED → PUBLISHED. ngteco-import chains into detect-exceptions on success.
- PDFs via `@react-pdf/renderer`: individual payslip, single-page admin signature report (25-employee constraint), optional cut-sheet.
- Dashboard centerpiece (`PayrollRunCard`) — state-driven, fills ~50% viewport, single primary CTA.
- `/payroll/run/[runId]` review with state-aware Approve flow that enqueues the publish job.
- Employee `/pay` + `/pay/[periodId]` viewer with iframe of the auth-gated `/api/payslips/[id]/pdf` route + inline Acknowledge.
- In-app notifications stub (Phase 5 promotes it to the full router with Web Push).

**Phase 2 — NGTeco automation.** Encrypted credentials, Playwright scraper with persistent profile + 2FA/CAPTCHA detection + screenshot/HTML capture on failure, parser at 100% branch coverage, run history + run detail UI, two new pg-boss queues (`ngteco.import`, `payroll.run.tick`).

**Phase 1 — Admin core.** What ships:

- Foundation from Phase 0 (Next.js 15 / React 19 / TypeScript strict, Drizzle schema, Auth.js v5 + Argon2id, pg-boss, OTel, Docker, LX120 deploy automation).
- Pure pay computation in `lib/payroll/` with 100% branch coverage gated in CI: `computePay`, `period-boundaries`, `rounding`. Fixtures cover short days, suspicious longs, midnight crossings, mid-period rate changes, flat-task and mixed-mode employees, incomplete punches.
- Typed query layer in `lib/db/queries/` with transactional audit (audit insert enrolls in the same Drizzle transaction as every mutation): employees, shifts, pay periods, punches, rate history, audit reads.
- Admin pages: employees CRUD with rate history, time grid (per-period, color-coded, click-to-edit), period review with computed totals, audit log viewer (owner-only).
- Settings tabs (full implementations replacing Phase 0 stubs): pay periods, pay rules, shifts (CRUD + reorder + archive), security.
- pg-boss `period.rollover` job — daily 00:30 in company TZ, idempotent.
- `scripts/import-employees.ts` — dry-run-by-default CSV importer with title-case + dedupe.
- `scripts/seed-demo.ts` — 24 employees, 5 periods, realistic punches, two seeded alerts on the open period.

Phase 0.5 fix included: `setSetting` no longer throws when the prior row is missing or shape-stale (the bug that caused `/setup` to silently lose company settings).

## Local development

```bash
nvm use                                   # uses .nvmrc → Node 22.11
npm install
cp .env.example .env
# Generate secrets:
echo "AUTH_SECRET=$(openssl rand -base64 48)" >> .env
echo "NGTECO_VAULT_KEY=$(openssl rand -base64 32)" >> .env

# Bring up Postgres only (or use the full compose stack):
docker compose up -d db

npm run db:generate                       # only when schema changed
npm run db:migrate
npm run seed
npm run dev                               # http://localhost:3000
```

First visit goes to `/setup` (no users yet). Create the OWNER, then sign in.

## Deploy to LX120

One-shot install on the LXC (run as root):

```bash
curl -fsSL https://raw.githubusercontent.com/kidevu123/payroll/rebuild/foundation/deploy/lxc/install.sh \
  | bash -s -- rebuild/foundation
```

What it does:

1. Installs Docker if missing
2. Clones the repo into `/opt/payroll`
3. Generates `/etc/payroll/.env` with random `AUTH_SECRET`, `NGTECO_VAULT_KEY`, Postgres password (mode 0600)
4. Installs `payroll-deploy.{service,timer}` — every 60s the LXC fetches the branch, and rebuilds + recreates the stack if HEAD changed
5. Starts everything

After that, your dev loop is:

```bash
git push origin rebuild/foundation
# ...wait up to ~60s
# LX120 has it.
```

To switch deployment to `main` (after Phase 1 ships), edit `/etc/systemd/system/payroll-deploy.service.d/override.conf`, set `PAYROLL_BRANCH=main`, then `systemctl daemon-reload && systemctl restart payroll-deploy.service`.

See `docs/deploy-proxmox.md` for sizing, mounts, backup retention, and restore.

## Project layout

Everything in this tree is opinionated by the spec.

```
/app
  /(employee)              # mobile PWA (Phase 4)
  /(admin)                 # admin dashboard
  /(auth)                  # login + first-run setup
  /api/health              # health probe used by docker compose + deploy script
  /api/auth/[...nextauth]  # Auth.js handlers (only API route shipping today)
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
/drizzle                   # generated migrations
/scripts                   # migrate, seed (idempotent)
/deploy/lxc                # install.sh + systemd units
/docs                      # spec, deploy notes, runbook, i18n glossary
```

## Conventions (locked)

- **Money is integer cents.** Always. The `formatMoney(cents)` helper is the only place cents become dollars.
- **Times are `timestamptz`.** Display respects `company.timezone` (Setting).
- **Server actions are the API.** Live next to their page in `actions.ts`, start with `"use server"`, validate with Zod.
- **Authz at the action layer**, not just middleware. `requireAdmin()` / `requireOwner()` from `lib/auth-guards`.
- **Every mutation writes an audit row** before commit (`writeAudit()` in `lib/db/audit`).
- **No emoji.** Anywhere. Use Lucide icons + colored chips + text labels.
- **Lists use shadcn primitives.** Don't import emoji glyphs, even from third-party libraries.

## Tests

```bash
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint
```

`npm test` runs vitest with v8 coverage; the gate is 100% on `lib/payroll/**/*.ts` for lines, functions, branches, and statements. Phase 2 adds Playwright snapshot tests against fixtures.

## Operations

- **Logs:** structured JSON to stdout. `docker compose logs -f app | jq`.
- **Backups:** `data/backups/payroll-*.dump` once per day, pruned after 30d.
- **Restore:** `docs/runbook.md` covers it.
- **Health:** `GET /api/health` returns 200 with `{ status: "ok", checks: { app, db, boss } }`.

## License

Proprietary; internal use only.
