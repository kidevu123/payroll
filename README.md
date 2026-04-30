# Payroll

Self-hosted payroll and employee operations platform. Single-tenant, single-purpose, gross-pay only. Designed so the owner runs payroll in under five minutes a week.

This is a ground-up rebuild — see `docs/spec.md` for the design contract. This README is operational.

## Status

**Phase 0 — Foundation.** What's in this branch:

- Next.js 15 (App Router) + React 19, TypeScript strict, Tailwind v4, shadcn primitives
- Drizzle schema for all Phase 0 entities (Employee, Shift, PayPeriod, Punch, Setting, AuditLog, plus the rest of the domain)
- Auth.js v5 with email + password, Argon2id, Postgres-backed rate limiting, first-run `/setup` flow
- Typed Settings infrastructure with all §4 tabs scaffolded and the Company tab fully editable
- pg-boss bootstrap, OpenTelemetry (console exporter by default, OTLP via env), `/api/health`
- Multi-stage Dockerfile, `docker-compose.yml` (app + postgres + backup sidecar)
- LX120 deploy automation: `deploy/lxc/install.sh` + systemd timer that pulls every 60s

The admin shell is live with all sidebar tabs visible — most surface "Lands in Phase N" placeholders. Phase 1 starts populating real flows.

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

Phase 1 lights up coverage gates on `/lib/payroll/*`. Phase 2 adds Playwright snapshot tests against fixtures.

## Operations

- **Logs:** structured JSON to stdout. `docker compose logs -f app | jq`.
- **Backups:** `data/backups/payroll-*.dump` once per day, pruned after 30d.
- **Restore:** `docs/runbook.md` covers it.
- **Health:** `GET /api/health` returns 200 with `{ status: "ok", checks: { app, db, boss } }`.

## License

Proprietary; internal use only.
