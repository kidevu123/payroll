#!/usr/bin/env bash
# One-command payroll deploy — push-based, verified (trade-show-app pattern).
#
#   ./deploy.sh          push current branch, deploy to LXC 120, verify
#
# Coexists with the 60s pull-timer (payroll-deploy.timer): this script
# brings the box to origin HEAD immediately with live feedback; the timer
# then no-ops because HEAD and /app/.git-sha already match.
set -euo pipefail

PROXMOX="root@192.168.1.190"
CTID=120
APP_DIR=/opt/payroll
BRANCH=rebuild/foundation

echo "==> Pushing $BRANCH to origin"
git push origin "$BRANCH"
SHA=$(git rev-parse HEAD)
echo "==> Target SHA: $SHA"

echo "==> Pausing pull-timer (avoids concurrent compose runs)"
ssh "$PROXMOX" pct exec "$CTID" -- systemctl stop payroll-deploy.timer || true
trap 'ssh "$PROXMOX" pct exec "$CTID" -- systemctl start payroll-deploy.timer || true' EXIT

echo "==> Deploying on LXC $CTID ($APP_DIR)"
ssh "$PROXMOX" pct exec "$CTID" -- bash -c "'
set -e
cd $APP_DIR
git fetch origin
git reset --hard origin/$BRANCH
NEW=\$(git rev-parse HEAD)
CUR=\$(docker compose exec -T app cat /app/.git-sha 2>/dev/null || echo none)
if [ \"\$CUR\" = \"\$NEW\" ]; then
  echo \"Already running \$NEW — no rebuild needed\"
else
  echo \"Building \$NEW (was \$CUR)\"
  BUILD_GIT_SHA=\$NEW docker compose up -d --build --remove-orphans
fi
'"

echo "==> Verifying health + SHA"
ssh "$PROXMOX" pct exec "$CTID" -- bash -c "'
cd $APP_DIR
for i in \$(seq 1 60); do
  curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && break
  sleep 5
done
curl -fsS http://localhost:3000/api/health >/dev/null && echo \"health: OK\" || { echo \"health: FAILED\"; exit 1; }
RUNNING=\$(docker compose exec -T app cat /app/.git-sha)
echo \"running SHA: \$RUNNING\"
'"

RUNNING=$(ssh "$PROXMOX" pct exec "$CTID" -- bash -c "'cd $APP_DIR && docker compose exec -T app cat /app/.git-sha'" | tr -d '[:space:]')
if [ "$RUNNING" = "$SHA" ]; then
  echo "✅ Deployed and verified: $SHA"
else
  echo "⚠️  SHA mismatch — pushed $SHA but running $RUNNING (build may still be in progress)"
  exit 1
fi
