# Multi-phase build handoff

Phase 0 is live on LX120. Phases 0.5 through 6 are queued for autonomous execution per the owner's direction. This file is the operational runbook for Claude Code (or any contributor) driving that build.

The phase plan and per-phase deliverables live in `docs/phases.md`. This file is the *how*: how to drive each phase, how to verify it, how to recover from failures.

---

## Pre-flight (run once before starting Phase 0.5)

```bash
cd ~/Documents/payroll-rebuild
git status                                      # expect clean
git fetch origin
git rev-parse HEAD                              # remember this for rollback
git rev-parse origin/rebuild/foundation         # should match HEAD
gh auth status 2>&1 | head -3                   # confirm GitHub auth
ssh -o ConnectTimeout=5 -o BatchMode=yes root@192.168.1.190 'pct exec 120 -- echo ok'
                                                # confirm LX120 SSH
```

Note the starting SHA. If anything goes wrong mid-build, that's the rollback point.

---

## The per-phase loop

Every phase from 0.5 through 6 follows the same six-step rhythm:

### 1. Read

Open `docs/phases.md` and re-read the phase you're about to execute. Note the file inventory, queries, components, tests, migrations, and "Done when" gates.

### 2. Plan with TodoWrite

Use the TodoList tool. Create one task per major deliverable (queries, components, jobs, tests, docs, migration, demo seed update). Mark them `in_progress` as you work.

### 3. Build

Implement. Conventional Commit prefixes: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `db`. One topical commit per concern — not one mega-commit. Commit as you go; don't wait until the end.

When you add tables/columns/indexes:

```bash
DATABASE_URL="postgres://placeholder:placeholder@localhost:5432/placeholder" \
  npm run db:generate
git add drizzle
git commit -m "db: phase-N migration"
```

The generated SQL must be reversible — `drizzle-kit drop` should clean up. If it can't, restructure.

### 4. Verify locally

```bash
npm run typecheck
npm run lint
npm test
```

All three must pass clean. Coverage gates from `vitest.config.ts` must be green. Zero skipped tests, zero `// @ts-expect-error`.

If a test fails: fix the test or fix the code, don't skip it.

### 5. Push and deploy

```bash
git push origin rebuild/foundation
```

The LX120 systemd timer (`payroll-deploy.timer`) fires every 60 seconds. It runs `git fetch && git reset --hard origin/rebuild/foundation` and rebuilds the docker compose stack only if HEAD changed.

### 6. Smoke test

```bash
LXC_IP=$(ssh root@192.168.1.190 'pct exec 120 -- hostname -I | awk "{print \$1}"' | tr -d '\r\n')

# Wait up to 4 minutes for build + restart
for i in $(seq 1 48); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://${LXC_IP}:3000/api/health" || echo 000)
  echo "[$i/48] /api/health → $status"
  [ "$status" = "200" ] && break
  sleep 5
done

curl -s "http://${LXC_IP}:3000/api/health" | jq
```

If health is green, run the phase-specific smoke check (each phase in `docs/phases.md` has a "Done when" list — verify each item).

If health is red, tail logs:

```bash
ssh root@192.168.1.190 -t 'pct exec 120 -- bash -c "
  cd /opt/payroll && docker compose logs --tail=200 app
"'
```

Fix forward. If you're stuck for more than 15 minutes on the same error, stop and surface.

### 7. Tag and post

```bash
git tag phase-N-done
git push --tags
```

Post a short progress message in the chat:

> Phase N done. Commits A..B on rebuild/foundation, deployed to <ip>. Health green. Demo seed updated. Notable deviations: <none | list>. Starting Phase N+1.

Then loop back to step 1 with the next phase.

---

## Phase order

1. **Phase 0.5** — pre-flight bug fixes (Setting audit-before, login state, vitest)
2. **Phase 1** — admin core
3. **Phase 2** — NGTeco automation
4. **Phase 3** — payroll run state machine + PDFs
5. **Phase 4** — employee PWA
6. **Phase 5** — requests + notifications
7. **Phase 6** — reports + polish

Don't skip ahead. Each phase's "Done when" gates must all be green before the next phase starts.

After Phase 6 ships and the owner signs off, see `docs/phases.md` § "After Phase 6" for the merge-to-main procedure.

---

## Recovery: when something breaks mid-phase

### A migration breaks production data

Stop. Don't try to fix forward.

```bash
# On LX120
ssh root@192.168.1.190 'pct exec 120 -- bash -c "
  cd /opt/payroll && docker compose stop app
  docker compose exec -T db pg_dump --format=custom --file=/backups/before-rollback-$(date +%s).dump
"'
```

Then revert the offending commit on the Mac:

```bash
git revert <bad-sha>
git push
```

Wait for the LXC to redeploy. Verify `/api/health`.

### A test starts failing intermittently

Don't skip it. If it's flaky, the test is wrong (or the code has a race). Fix the root cause.

### LX120 disk fills up

`/data/backups` is the most likely culprit. The backup sidecar prunes to 30 days but `pg_dump` over time grows. Bump LXC disk (Proxmox UI) or shorten retention.

### "It worked locally but not on LX120"

Check the Dockerfile and `docker-compose.yml` for things you forgot to copy. The standalone bundle (`output: 'standalone'`) in `next.config.mjs` only includes server-side code Next.js can statically trace; if you import something dynamically, mark it explicitly via `serverExternalPackages` or copy it manually.

---

## Owner intervention

The owner can stop the autonomous build at any time by:

- Killing the Claude Code session (Ctrl+C in their terminal)
- Pausing the deploy timer on LX120: `ssh root@192.168.1.190 'pct exec 120 -- systemctl stop payroll-deploy.timer'`
- Force-pushing to `rebuild/foundation` themselves (their commits become the new HEAD)

If the owner asks for a hard pause mid-phase, leave the workspace clean (no uncommitted changes), commit any in-flight work as `wip(phase-N): <description>`, and report.

---

## Demo seed maintenance

`scripts/seed-demo.ts` is upgraded across phases. Each phase's "Done when" includes "Demo seed updated." Don't let the demo seed rot — it's the primary visual reference for "is this working?"

To run the demo seed:

```bash
# Locally against a dev DB:
npm run seed:demo

# Against the LXC:
ssh root@192.168.1.190 -t 'pct exec 120 -- bash -c "
  cd /opt/payroll && docker compose exec -T app \
    node ./node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts
"'
```

The demo seed is idempotent (uses `onConflictDoNothing`). Re-running just adds anything new. To wipe and start fresh:

```bash
# DESTRUCTIVE — only run on a non-production database
ssh root@192.168.1.190 -t 'pct exec 120 -- bash -c "
  cd /opt/payroll && docker compose exec -T app \
    node ./node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts --reset
"'
```

Don't ship `--reset` against production data.

---

## Conventions reminder

The spec's anti-patterns (§22) are non-negotiable:

- No emoji anywhere
- Money is integer cents
- No floats for money
- Lucide icons + colored chips + text labels
- Server actions are the API
- Authz at the action layer
- Audit on every mutation
- Settings are levers, not assumptions
- Tests are required, not optional

Read `CLAUDE.md` if any of these surprises you.
