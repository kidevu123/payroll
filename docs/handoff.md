# Phase 0 bring-up handoff

This file is the runbook for Claude Code (or a careful human) to take the locally-written Phase 0 scaffolding and turn it into a live deployment. The original Phase 0 architecture work happened in Cowork mode, which can't reach GitHub, the npm registry, or the LAN — so what's here is "code complete, never installed, never pushed, never deployed."

If you're Claude Code, work this list top to bottom. Stop and ask the owner if any step in the **Stop and ask** section trips. Verify each step's success criteria before moving on.

---

## Pre-flight

You're operating from `~/Documents/payroll-rebuild` on the owner's Mac. Confirm:

```bash
cd ~/Documents/payroll-rebuild
ls CLAUDE.md docs/spec.md package.json
```

If any of those files is missing, stop — something is wrong with the working directory.

Confirm Node 22 is available:

```bash
node --version   # expect v22.x
```

If not, suggest `nvm use` (the repo has a `.nvmrc`).

Confirm GitHub auth works:

```bash
gh auth status 2>&1 | head -3 || git ls-remote git@github.com:kidevu123/payroll.git HEAD 2>&1 | head -3
```

You need **either** `gh` authenticated **or** a working SSH key for `kidevu123`. Don't proceed without confirming one of those.

Confirm SSH to the PVE host works:

```bash
ssh -o ConnectTimeout=5 -o BatchMode=yes root@192.168.1.190 'pct list | grep -E "^120 "'
```

Expect a line showing container 120's status. If this fails, stop and ask the owner about SSH key setup.

---

## 1. Re-init the local git history

The Cowork sandbox left a partial `.git` directory because the FUSE mount couldn't unlink lockfiles. Wipe and re-init clean:

```bash
cd ~/Documents/payroll-rebuild
rm -rf .git
git init -q -b rebuild/foundation
git add -A
git -c "user.email=$(git config --global user.email)" \
    -c "user.name=$(git config --global user.name)" \
    commit -q -m "Phase 0: foundation

Greenfield rebuild per spec v2 (docs/spec.md). Phase 0 ships:

- Next.js 15 (App Router) + React 19 + Tailwind v4 + shadcn primitives
- Drizzle schema for all Phase 0 entities + the rest of the domain
- Auth.js v5 with email + password (Argon2id), Postgres-backed rate
  limiting, first-run /setup flow, edge-safe redirect-only middleware
- Typed Settings infrastructure: Zod-per-key, per-request memo cache,
  audit-on-write. All section 4 tabs scaffolded; Company tab editable.
- pg-boss bootstrap with a heartbeat job
- OpenTelemetry SDK with console exporter (OTLP via env)
- /api/health checks app + db + boss
- Multi-stage Dockerfile (Playwright base for Phase 2 readiness)
  + docker-compose.yml (app + postgres + daily backup sidecar)
- LX120 deploy automation: install.sh + systemd unit + 60s timer
- Spanish translations seeded from the i18n glossary
- README, deploy-proxmox.md, runbook.md, ngteco-troubleshooting.md
"
```

**Success criterion:** `git log --oneline` shows one commit; `git status` is clean.

---

## 2. Install dependencies and verify the build

```bash
npm install
```

If `npm install` fails on version pins (the package.json targets a React 19 RC and Tailwind v4 beta because the spec was written before stable releases existed), update to the current stable releases:

- `react` and `react-dom`: latest stable 19.x (drop the RC pin).
- `next`: 15.x latest.
- `tailwindcss` and `@tailwindcss/postcss`: latest 4.x stable.
- `next-auth`: latest 5.x beta (Auth.js v5 hasn't shipped 5.0 stable yet).

After updating, re-run `npm install` and commit the change as a separate commit (`chore: bump deps to current stable`).

Then verify:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm test             # vitest run
```

All three should pass with zero errors. The smoke test in `lib/utils.test.ts` is the only test for Phase 0; it just confirms the runner works.

If `npm run lint` complains about a missing eslint config, accept Next.js's default by running `npx next lint` once interactively (it will create `.eslintrc.json`), then commit that file.

**Success criterion:** typecheck and tests pass cleanly.

---

## 3. Generate the initial Drizzle migration

The migrator refuses to start with an empty `/drizzle` folder, so generate the baseline locally and commit it:

```bash
# Need a Postgres URL to introspect, but generate doesn't actually connect —
# any URL string is fine for `generate`. Provide a placeholder:
DATABASE_URL="postgres://placeholder:placeholder@localhost:5432/placeholder" \
  npm run db:generate
```

That writes `/drizzle/0000_*.sql` and `/drizzle/meta/_journal.json` plus a snapshot. Commit them:

```bash
git add drizzle
git commit -m "drizzle: initial migration"
```

**Success criterion:** `/drizzle/0000_*.sql` exists and contains `CREATE TABLE` statements for `users`, `employees`, `pay_periods`, `punches`, `settings`, `audit_log`, etc. (all 18 tables in `lib/db/schema.ts`).

---

## 4. Push to GitHub

The owner's repo at `github.com/kidevu123/payroll` may have legacy `main` content. **Do not touch `main`.** Push only `rebuild/foundation`:

```bash
git remote add origin git@github.com:kidevu123/payroll.git \
  || git remote set-url origin git@github.com:kidevu123/payroll.git

# Use force-with-lease in case rebuild/foundation already exists from a prior
# attempt; this won't touch any other branch.
git push -u --force-with-lease origin rebuild/foundation
```

**Success criterion:** `gh repo view kidevu123/payroll --json defaultBranchRef,refs` (or visiting GitHub) shows `rebuild/foundation` exists and `main` is untouched.

---

## 5. Bring up LX120

You have two options. Pick based on whether the LXC already has a payroll deploy:

```bash
ssh root@192.168.1.190 'pct exec 120 -- ls /opt/payroll 2>/dev/null && echo EXISTS || echo FRESH'
```

### 5a. Fresh LX120 (no existing deploy)

Run the one-shot installer over SSH. It clones the repo, installs Docker if missing, generates secrets, installs the systemd timer, and starts the stack:

```bash
ssh root@192.168.1.190 -t \
  'pct exec 120 -- bash -c "curl -fsSL https://raw.githubusercontent.com/kidevu123/payroll/rebuild/foundation/deploy/lxc/install.sh | bash -s -- rebuild/foundation"'
```

Watch the output. If anything fails, snapshot the error and stop — don't try to recover blindly.

### 5b. Existing LX120 with a previous (legacy) payroll deploy

**Stop and ask** before touching it. The owner said legacy reports and payslips need to remain accessible. The legacy install may be holding files we want to migrate. Don't `docker compose down --volumes` or remove `/opt/payroll` without explicit owner approval.

If the owner gives the OK, the safe upgrade is:

```bash
# Save the legacy state first
ssh root@192.168.1.190 'pct exec 120 -- bash -c "
  cd /opt/payroll &&
  docker compose ps &&
  ls -la data/ &&
  date
" '
# Then back up the legacy data dir
ssh root@192.168.1.190 'pct exec 120 -- bash -c "
  cp -r /opt/payroll/data /root/payroll-legacy-data-$(date +%Y%m%d)
" '
# Then run the installer (it preserves /etc/payroll/.env if present, and
# the install.sh script is idempotent)
```

---

## 6. Verify the deployment

```bash
# Get the LXC IP
LXC_IP=$(ssh root@192.168.1.190 'pct exec 120 -- hostname -I | awk "{print \$1}"' | tr -d '\r\n')
echo "LXC IP: $LXC_IP"

# Wait up to 2 minutes for first build to finish
for i in $(seq 1 24); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://${LXC_IP}:3000/api/health" || echo 000)
  echo "[$i/24] /api/health → $status"
  [ "$status" = "200" ] && break
  sleep 5
done

# Final state
curl -s "http://${LXC_IP}:3000/api/health" | jq
```

**Success criterion:** `/api/health` returns 200 with `{ status: "ok", checks: { app: "ok", db: "ok", boss: "ok" } }`.

If `db` or `boss` is `error`, tail the logs:

```bash
ssh root@192.168.1.190 -t 'pct exec 120 -- bash -c "
  cd /opt/payroll && docker compose logs --tail=200 app
"'
```

The most likely failure modes are:
- Migrations folder empty → you skipped step 3.
- `DATABASE_URL` mismatch → check `/etc/payroll/.env` matches what compose passes.
- `argon2` native build issue → the runtime image is `mcr.microsoft.com/playwright:v1.48.2-jammy` which has libstdc++ etc.; if it fails, the npm install in the build stage probably hit a network issue.

---

## 7. Smoke test the UI

Open `http://${LXC_IP}:3000` in a browser. It should redirect to `/setup`. Create the OWNER account. After redirect to `/login`, sign in. You should land on the empty admin dashboard with the sidebar (Dashboard, Employees, Time, Payroll, Requests, NGTeco, Reports, Settings) and Settings tabs (Company is the only editable one in Phase 0; the rest show "Lands in Phase N" placeholders).

If any of that is broken, capture a screenshot or the network tab and report it. Don't try to fix it without owner direction.

---

## 8. Report back

When everything is green, summarize:

- Commit SHA on `rebuild/foundation`
- LX120 IP and the URL the owner can hit
- That `main` was not touched
- Any deviations you had to make (dep version bumps, eslint config, etc.)

Then **stop and wait** for the owner to greenlight Phase 1. Per spec §23: do not start a new phase without explicit go-ahead.

---

## Stop and ask

Stop and ask the owner before doing any of the following:

- Touching `main` on `kidevu123/payroll`
- Running `docker compose down --volumes` or anything that drops the Postgres volume
- Removing or modifying `/opt/payroll/data` on the LXC if a previous deploy exists there
- Adding any feature, file, or behavior not described in `docs/spec.md`
- Bumping any dependency to a major version that isn't required to make `npm install` succeed
- Disabling 2FA, the audit log, or any other security control listed in spec §13
- Importing legacy data — owner has not yet provided the source

If you're unsure, default to asking. The owner explicitly said they're nervous about messing things up, which means caution wins over speed.
