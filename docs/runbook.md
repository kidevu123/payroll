# Runbook

Operational notes for running the payroll platform. Phase 0 surface is small; this file grows as more behavior lands.

## Sunday night payroll (target ≤5 minutes, owner-facing)

When Phase 3 is live:

1. Open the dashboard. The "Current payroll run" card is the only thing that matters.
2. If state is `AWAITING_ADMIN_REVIEW`, click **Review**, scan totals + warnings, **Approve**.
3. Done.

If state is `INGEST_FAILED`, the card surfaces the failure with a link to the screenshot + page HTML. Either:
- Click **Retry import** if it looks transient
- Click **Edit selectors** if NGTeco changed their UI

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

`{ status: "degraded", checks: { db: "error" } }` → Postgres is down or unreachable. Check `docker compose logs db`.

`{ status: "degraded", checks: { boss: "error" } }` → pg-boss couldn't claim its schema. Usually means the `pgboss` schema couldn't be created (permissions). Open a shell on the db service and verify the `payroll` user owns the database.

### Login locked out

Login rate limit is 5 failures per 15 minutes per email by default. Adjust in Settings → Security. To clear an account's lockout immediately:

```
docker compose -f /opt/payroll/docker-compose.yml exec -T db \
  psql -U payroll -d payroll -c "UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = 'you@example.com';"
```

### Owner forgot password

Phase 1 will ship a CLI:

```
docker compose -f /opt/payroll/docker-compose.yml exec -T app \
  node ./node_modules/tsx/dist/cli.mjs scripts/admin-reset.ts you@example.com
```

For now (Phase 0): connect to the db and reset the hash by hand:

```
docker compose -f /opt/payroll/docker-compose.yml exec -T app \
  node ./node_modules/tsx/dist/cli.mjs -e "
    import('./lib/auth.js').then(async ({ hashPassword }) => {
      console.log(await hashPassword('NEW_PASSWORD_HERE'));
    });
  "

# Then:
docker compose -f /opt/payroll/docker-compose.yml exec -T db \
  psql -U payroll -d payroll -c "UPDATE users SET password_hash = '<paste-hash>' WHERE email = 'you@example.com';"
```

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

See `docs/deploy-proxmox.md`. tl;dr — daily nightly to `/data/backups`, 30-day retention, restore is one command.

## Rolling forward to Phase 1

When Phase 1 lands on `main`, change the deploy branch (covered in `deploy-proxmox.md` under "Branches"). The migrator runs on every container start, so schema deltas land automatically.

## Where logs go

- App + jobs → stdout, captured by docker
- Auth events + mutations → `audit_log` table
- NGTeco import artifacts → `/data/ngteco/{imports,failures}/` (Phase 2+)
- Generated payslip PDFs → `/data/payslips/<year>/<period>/` (Phase 3+)
