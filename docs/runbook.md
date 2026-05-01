# Runbook

Operational notes for running the payroll platform.

## Sunday night payroll (target ≤5 minutes, owner-facing)

1. Open the dashboard. The **Current payroll run** card is the only thing that matters.
2. If state is `AWAITING_ADMIN_REVIEW`, click **Approve**, scan the totals + alert pills on the per-employee table, click **Confirm publish**.
3. Done. PDFs land in `/data/payslips/<period-start>/`, payslips appear under each employee's `/me/pay`, and admins + employees both get `payroll_run.published` notifications.

If state is `AWAITING_EMPLOYEE_FIXES`, the card shows how many alerts are still open and the deadline (set from `automation.employeeFixWindowHours`). You can click **Advance to review** to skip the wait.

If state is `INGEST_FAILED`, the card surfaces the failure with a link to the captured screenshot. Either:

- Click **Retry ingest** if it looks transient (network blip, timeout)
- Edit `lib/ngteco/selectors.json` on the LXC if NGTeco changed their UI, then retry — selectors reload fresh on every run, no redeploy needed

## Common issues

### App won't start

```
docker compose -f /opt/payroll/docker-compose.yml logs --tail=200 app
```

Look for:

- `DATABASE_URL is not set` → `/etc/payroll/.env` missing or unreadable
- `AUTH_SECRET must be set` → same
- `migrations` errors → database in a weird state; restore from a recent dump

### Health check failing

```
curl -s http://localhost:3000/api/health | jq
```

- `{ status: "degraded", checks: { db: "error" } }` → Postgres is down or unreachable. Check `docker compose logs db`.
- `{ status: "degraded", checks: { boss: "error" } }` → pg-boss couldn't claim its schema. Usually means the `pgboss` schema couldn't be created (permissions). Open a shell on the db service and verify the `payroll` user owns the database.

### Login locked out

Login rate limit is 5 failures per 15 minutes per email by default. Adjust in **Settings → Security**. To clear an account's lockout immediately:

```
docker compose -f /opt/payroll/docker-compose.yml exec -T db \
  psql -U payroll -d payroll -c "UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = 'you@example.com';"
```

### Owner forgot password

Generate a hash (uses argon2id with the same parameters the app does):

```
docker compose -f /opt/payroll/docker-compose.yml exec -T app sh -c '
  node -e "
    require(\"@/lib/auth\").hashPassword(\"NEW_PASSWORD_HERE\").then(h => console.log(h));
  "
'
```

Then update the row:

```
docker compose -f /opt/payroll/docker-compose.yml exec -T db \
  psql -U payroll -d payroll \
  -c "UPDATE users SET password_hash = '<paste-hash>' WHERE email = 'you@example.com';"
```

### NGTeco import keeps failing

See `docs/ngteco-troubleshooting.md`. The two most common root causes are selector drift (NGTeco changed their UI) and a 2FA challenge accidentally enabled on the service account.

### Push notifications stopped working

```
docker compose -f /opt/payroll/docker-compose.yml exec -T db \
  psql -U payroll -d payroll -c "SELECT count(*) FROM push_subscriptions;"
```

If 0, no devices are subscribed — nothing's broken, the operator just hasn't enabled push on any device yet (`/me/profile/notifications`).

If non-zero but no notifications are landing, check that `VAPID_*` are set in `/etc/payroll/.env`:

```
grep VAPID /etc/payroll/.env
```

If missing, re-run `deploy/lxc/install.sh` — it backfills the keys without rotating the existing ones (which would brick all subscriptions).

### Deploy didn't pick up a push

```
sudo systemctl status payroll-deploy.timer
sudo systemctl status payroll-deploy.service
sudo journalctl -u payroll-deploy --since '5 minutes ago'
```

If the service is firing but `before == after`, the new commit isn't on the branch the LXC tracks. Check:

```
cat /etc/systemd/system/payroll-deploy.service.d/override.conf
```

Branch should match what you pushed to.

### Manual rebuild

```
sudo systemctl start payroll-deploy.service
```

The unit is `Type=oneshot` so this just runs the cycle once.

## Backups

Daily `pg_dump --format=custom` lands in `/data/backups/payroll-<timestamp>.dump`. Retention is 30 days (configurable via `BACKUP_RETENTION_DAYS` in `/etc/payroll/.env`).

### Restore drill (do this once a quarter)

```
# Pick a recent dump.
ls -lh /opt/payroll/data/backups | tail -5

# Drop and recreate the db (DESTRUCTIVE — use only for restore drills).
docker compose -f /opt/payroll/docker-compose.yml exec -T db dropdb -U payroll payroll
docker compose -f /opt/payroll/docker-compose.yml exec -T db createdb -U payroll payroll

# Restore.
docker compose -f /opt/payroll/docker-compose.yml exec -T db \
  pg_restore -U payroll -d payroll < /opt/payroll/data/backups/payroll-XXXXXXXXTXXXXXXZ.dump

# Bring the app back up — it will run migrations + seed on next start.
docker compose -f /opt/payroll/docker-compose.yml restart app
curl -s http://localhost:3000/api/health | jq
```

## Rolling forward branches

When `rebuild/foundation` merges to `main`, switch the LXC to track main:

```
sudo sed -i 's|rebuild/foundation|main|' /etc/systemd/system/payroll-deploy.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart payroll-deploy.service
```

## Where logs go

- App + jobs → stdout, captured by docker
- Auth events + mutations → `audit_log` table (visible at `/audit`, owner-only)
- NGTeco import artifacts → `/data/ngteco/{profile,failures}/`
- Generated payslip PDFs → `/data/payslips/<period-start>/`
- Daily backups → `/data/backups/`
