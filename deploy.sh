#!/usr/bin/env bash
# One-command verified deploy.
#
#   ./deploy.sh    push current branch, trigger the deploy unit, verify
#
# Reuses the LXC's own payroll-deploy.service (git reset + compose rebuild
# on HEAD change/drift). systemd serializes service runs, so triggering it
# directly cannot race the 60s timer — this replaces waiting for the next
# tick with an immediate, watched, verified deploy.
set -euo pipefail

PROXMOX="root@192.168.1.190"
CTID=120
APP_DIR=/opt/payroll
BRANCH=rebuild/foundation

echo "==> Pushing $BRANCH to origin"
git push origin "$BRANCH"
SHA=$(git rev-parse HEAD)
echo "==> Target SHA: $SHA"

echo "==> Triggering payroll-deploy.service on LXC $CTID (blocks until done)"
ssh "$PROXMOX" pct exec "$CTID" -- systemctl start payroll-deploy.service

echo "==> Verifying health + running SHA"
ssh "$PROXMOX" pct exec "$CTID" -- bash -c "'
set -e
cd $APP_DIR
for i in \$(seq 1 24); do
  curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 && break
  sleep 5
done
curl -fsS http://localhost:3000/api/health >/dev/null
docker compose exec -T app cat /app/.git-sha
'" > /tmp/payroll-deploy-verify.out
RUNNING=$(tail -1 /tmp/payroll-deploy-verify.out | tr -d '[:space:]')

if [ "$RUNNING" = "$SHA" ]; then
  echo "Deployed and verified: $SHA (health OK)"
else
  echo "MISMATCH: pushed $SHA but running ${RUNNING:-unknown} — check journalctl -u payroll-deploy on the LXC"
  exit 1
fi
