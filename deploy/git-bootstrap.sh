#!/usr/bin/env bash
# One-shot: re-init the local git history (the Cowork sandbox couldn't finalize
# its own commit due to a filesystem mount quirk), wire up the kidevu123/payroll
# remote, commit Phase 0, and push the rebuild/foundation branch.
#
# Run this from the repo root on your Mac terminal — NOT from inside Cowork:
#
#   cd ~/Documents/payroll-rebuild
#   bash deploy/git-bootstrap.sh
#
# Idempotent: re-running just amends/pushes any uncommitted changes.

set -euo pipefail

REPO_REMOTE="${REPO_REMOTE:-git@github.com:kidevu123/payroll.git}"
BRANCH="${BRANCH:-rebuild/foundation}"

# 1. Wipe the half-written .git from the sandbox and start fresh.
if [[ -d .git ]]; then
  echo "[git] removing existing .git (sandbox left it half-written)"
  rm -rf .git
fi

# 2. Init, set the branch.
git init -q -b "${BRANCH}"
git config user.email "$(git config --global user.email || echo 'you@example.com')"
git config user.name "$(git config --global user.name || echo 'Owner')"

# 3. Stage + commit.
git add -A
if git diff --cached --quiet; then
  echo "[git] nothing to commit"
else
  git commit -q -m "Phase 0: foundation

Greenfield rebuild per spec v2. Phase 0 ships:

- Next.js 15 (App Router) + React 19 + Tailwind v4 + shadcn primitives
- Drizzle schema for all Phase 0 entities + the rest of the domain
- Auth.js v5 with email + password (Argon2id), Postgres-backed rate
  limiting, first-run /setup flow, edge-safe redirect-only middleware
- Typed Settings infrastructure: Zod-per-key, per-request memo cache,
  audit-on-write. All section 4 tabs scaffolded; Company tab fully editable.
- pg-boss bootstrap with a heartbeat job
- OpenTelemetry SDK with console exporter (OTLP via env)
- /api/health checks app + db + boss
- Multi-stage Dockerfile (Playwright base for Phase 2 readiness)
  + docker-compose.yml (app + postgres + daily backup sidecar)
- LX120 deploy automation: install.sh + systemd unit + 60s timer
- Spanish translations seeded from the i18n glossary
- README, deploy-proxmox.md, runbook.md, ngteco-troubleshooting.md
"
  echo "[git] committed Phase 0"
fi

# 4. Wire the remote.
if git remote get-url origin >/dev/null 2>&1; then
  current="$(git remote get-url origin)"
  if [[ "${current}" != "${REPO_REMOTE}" ]]; then
    git remote set-url origin "${REPO_REMOTE}"
    echo "[git] updated remote origin to ${REPO_REMOTE}"
  fi
else
  git remote add origin "${REPO_REMOTE}"
  echo "[git] added remote origin = ${REPO_REMOTE}"
fi

# 5. Push.
echo "[git] pushing ${BRANCH} to origin (force, since this branch is greenfield)..."
git push -u --force-with-lease origin "${BRANCH}"

echo
echo "Done. Next:"
echo "  • On LX120, run:"
echo "      curl -fsSL https://raw.githubusercontent.com/kidevu123/payroll/${BRANCH}/deploy/lxc/install.sh | bash -s -- ${BRANCH}"
echo "  • Locally, to develop:"
echo "      npm install"
echo "      npm run db:generate    # creates the initial Drizzle migration"
echo "      git add drizzle && git commit -m 'drizzle: initial migration' && git push"
echo "      docker compose up      # full stack"
