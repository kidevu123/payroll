# Deploying to Proxmox (LX120)

This walkthrough assumes a debian/ubuntu unprivileged LXC on Proxmox. The numbers are sized for the workload described in the spec — small manufacturing/distribution business, ~25 active employees, weekly payroll.

## LXC sizing

| Resource | Recommended | Why |
| --- | --- | --- |
| CPU | 2 vCPU | Build is the heavy moment; runtime is light |
| RAM | 2 GB | Postgres + Node + Playwright (Chromium) all in one container |
| Disk | 20 GB | App + postgres data + payslip PDFs + 30 days of nightly dumps |
| Swap | 1 GB | Insurance during builds |

Bind a host directory into the LXC if you want backups outside the container too:

```
mp0: /srv/payroll-data,mp=/data,backup=1
```

`/data` is where the compose stack mounts uploads, payslips, ngteco artifacts, and backups.

## Networking

The container needs:

- Outbound HTTPS to GitHub (for `git pull`) and Docker Hub / GHCR (for image pulls during build)
- Outbound HTTPS to your NGTeco portal (Phase 2+)
- Inbound TCP 3000 from your LAN, fronted by an HTTPS proxy (NGINX or Caddy on Proxmox or a separate LXC)

The compose stack does not terminate TLS; do that upstream. When fronted, set `TRUST_PROXY=true` in `/etc/payroll/.env` so the app honors `X-Forwarded-*`.

## Install

As root inside the LXC:

```bash
curl -fsSL https://raw.githubusercontent.com/kidevu123/payroll/rebuild/foundation/deploy/lxc/install.sh \
  | bash -s -- rebuild/foundation
```

The installer:

1. Installs Docker engine + compose plugin if missing.
2. Clones the repo into `/opt/payroll`.
3. Writes `/etc/payroll/.env` (mode 0600) with freshly generated `AUTH_SECRET`, `NGTECO_VAULT_KEY`, and Postgres password.
4. Installs the `payroll-deploy.service` + `payroll-deploy.timer` units. The timer fires every 60 seconds, the service does `git fetch && git reset --hard origin/<branch>`, and it rebuilds + recreates the stack only if HEAD changed.
5. Starts everything.

You should see the app at `http://<lxc-ip>:3000` within a couple of minutes.

## First-run setup

The very first request to `/` redirects to `/setup`. Create the OWNER account there. Once that exists, future restarts boot to `/login`.

## Branches

The installer pins to `rebuild/foundation` until Phase 1 ships. To switch:

```
sudo sed -i 's|rebuild/foundation|main|' /etc/systemd/system/payroll-deploy.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart payroll-deploy.service
```

## Backups

The `backup` sidecar in `docker-compose.yml` runs `pg_dump --format=custom` once a day to `/data/backups/payroll-<utc-iso>.dump`, pruning files older than `BACKUP_RETENTION_DAYS` (default 30).

To take an ad-hoc dump:

```
docker compose -f /opt/payroll/docker-compose.yml exec -T backup \
  pg_dump --format=custom --file=/backups/payroll-$(date -u +%Y%m%dT%H%M%SZ)-manual.dump
```

To restore:

```
# 1. Stop the app so writes are quiesced
docker compose -f /opt/payroll/docker-compose.yml stop app

# 2. Restore into a fresh database
docker compose -f /opt/payroll/docker-compose.yml exec -T db \
  pg_restore --clean --if-exists --no-owner -U payroll -d payroll \
  < /opt/payroll/data/backups/payroll-<file>.dump

# 3. Start the app back up
docker compose -f /opt/payroll/docker-compose.yml start app
```

The Setting table is part of the dump — you don't need to re-do company configuration after a restore.

## Observability

By default OTel exports spans to the container's stdout. To redirect:

```
# In /etc/payroll/.env
OTEL_EXPORTER_OTLP_ENDPOINT=http://<your-otel-collector>:4318/v1/traces
```

Restart the service:

```
sudo systemctl restart payroll-deploy.service
```

## Updating Docker / the host

`apt upgrade` on the LXC is fine; the compose stack rides on top. The deploy timer just keeps re-pulling the branch; you don't need to coordinate.

## Uninstall

```
sudo systemctl disable --now payroll-deploy.timer payroll-deploy.service
docker compose -f /opt/payroll/docker-compose.yml down --volumes
sudo rm -rf /opt/payroll /etc/payroll /etc/systemd/system/payroll-deploy.* /etc/systemd/system/payroll-deploy.service.d
```

This is destructive — the `--volumes` flag drops the Postgres database. Take a backup first.
