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

- **Phase 0 (Foundation): code complete, locally.** All scaffolding files exist. Not yet pushed to GitHub.
- **Phase 1+ : not started.** Do not start a new phase without explicit go-ahead from the owner (per spec §23).

The owner started Phase 0 from inside Cowork mode, where the sandbox can't reach GitHub, npm registry, or the LAN. So Phase 0 was written into `~/Documents/payroll-rebuild` but never installed, generated, or pushed. That's what `docs/handoff.md` is for.

## What you (Claude Code) should do first

If a fresh session: read `docs/handoff.md` and follow it. It walks through the remaining bring-up steps with explicit checkpoints and guardrails.

If picking up after Phase 0 is live: read the spec, confirm what phase the owner wants next (phases ship in order — see spec §15), and **stop to ask before starting any phase**. Phase 1 is admin core (Employee CRUD, Shift CRUD, manual punch entry, period auto-creation, `computePay` with full Vitest coverage, period review/lock, audit log viewer).

## Hard guardrails

- **Never force-push to `main`.** Greenfield work goes on `rebuild/foundation` until Phase 1 is approved by the owner.
- **Never run destructive operations on the LXC without confirming first.** `docker compose down --volumes` drops the database. So does dropping the data volume.
- **Never paste real secrets into chat or commit them.** AUTH_SECRET, NGTECO_VAULT_KEY, the Postgres password — those live in `/etc/payroll/.env` on the LXC, generated by `deploy/lxc/install.sh`, with file mode 0600.
- **NGTeco credentials go through the encrypted vault** (`lib/crypto/vault.ts`, AES-GCM with a 32-byte key from `NGTECO_VAULT_KEY`). The owner enters them through the Settings UI; never bypass the vault.
- **Don't add features the spec doesn't ask for.** If something feels missing, ask the owner before building it. The "Anti-patterns" section of the spec (§22) is the bar.

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
