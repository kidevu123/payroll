# Container Diet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the production image from 4.77 GB to at or under 1.6 GB with no change in app behaviour, and make rollback a retag instead of a rebuild.

**Architecture:** The Dockerfile's runtime stage moves from the all-browsers Playwright image to `node:24-bookworm-slim` with only the Chromium headless shell, and copies a production-only `node_modules`. Everything is built and checked in a throwaway Proxmox LXC against the current image as a baseline before LX120 sees it. The deploy unit gains a `previous` tag and a build-cache cap.

**Tech Stack:** Docker multi-stage build, Node 24 runtime (Node 22 build stages, unchanged), Playwright 1.59 Chromium headless shell, systemd, Proxmox `pct`.

**Spec:** `docs/superpowers/specs/2026-10-06-container-diet-design.md` — read it first; this plan argues from it.

## Global Constraints

- No file under `app/`, `components/`, `lib/`, `drizzle/`, `messages/`, or `mcp-server/src/` changes. No migration.
- Ports, volumes, environment variables and the image `CMD` do not change.
- The runtime Node major stays 24. The build stages stay on `node:22-bookworm-slim`.
- Every command in `docs/runbook.md` must work as written, in particular `node ./node_modules/tsx/dist/cli.mjs scripts/<script>.ts`.
- **Never push to `rebuild/foundation` before Task 7.** A push auto-deploys to production within 60 seconds. All commits before Task 7 stay local; the sandbox receives code by `git bundle`, not from GitHub.
- Nothing from production enters the sandbox: no `/etc/payroll/.env`, no database dump, no `/opt/payroll/data`.
- On LX120, do not delete `payroll-app:pre-mount` or `payroll-app:mount-stage` (the maintainer's), and do not delete `payroll-app:previous` without the user saying so.
- No destructive Postgres operations on LX120. Take a `pg_dump` before the deploy.
- No emoji anywhere, including commit messages.
- Production steps (Task 7) need the user's explicit go-ahead at that point, even though this plan is approved.
- Deploy away from the top of the hour (the punch poll runs at `:00`).
- The sandbox LXC is destroyed in Task 8. The work is not done until `pct list` no longer shows it.

## Review Focus

Conditions the spec implies that are most likely to bite, each pinned to a check:

1. **A package the app loads at runtime exists only in the developer install.** Expected: every runtime-loaded package resolves in the new image. Pinned by `deploy/verify-image.sh` check `runtime-modules` (Task 2) and the log grep in Task 7.
2. **`pgrep`/`pkill` are absent in a slim base, and the reaper swallows the error.** Expected: an orphaned headless browser is found and killed. Pinned by `verify-image.sh` check `reaper` (Task 2).
3. **Chromium is missing a shared library on Debian bookworm.** Expected: the headless shell launches and renders a page. Pinned by `verify-image.sh` check `chromium` (Task 2).
4. **A PDF route works in the developer's dev server but not in the standalone image** (the pre-compiled documents live at `/app/.next/pdf`). Expected: guide, signature report and cut sheet each return a valid PDF. Pinned by the phone-check script (Task 4).
5. **The deploy unit's new lines break auto-deploy, or a failed prune fails the deploy.** Expected: a deploy with the cache prune failing still ends healthy; a second deploy leaves `payroll-app:previous` pointing at the first image. Pinned by Task 5's sandbox run.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `Dockerfile` | modify | image build |
| `package.json`, `package-lock.json` | modify | `tsx` becomes a runtime dependency; version bump |
| `deploy/verify-image.sh` | create | repeatable in-container checks for any image built from this Dockerfile |
| `deploy/lxc/payroll-deploy.service` | modify | `previous` tag before rebuild, cache cap after |
| `docs/runbook.md` | modify | rollback procedure |
| `docs/spec.md` | modify | §19 image-size line, so the spec does not diverge |
| `CLAUDE.md` | modify | briefing entry |

Not in the repo (session scratchpad on the developer's Mac): `phone-check.mjs`, the WebKit iPhone check.

Shell variables used throughout, set once per shell:

```bash
PVE=root@192.168.1.190        # Proxmox host
SBX=<sandbox CTID from Task 1 Step 2>
SBX_IP=<sandbox IP from Task 1 Step 4>
```

---

### Task 1: Build sandbox

**Files:** none in the repo.

**Interfaces:**
- Produces: a running LXC `$SBX` at `$SBX_IP` with Docker, the repo at `/opt/payroll` on branch `rebuild/foundation`, and `/opt/payroll/.env` holding throwaway secrets. Later tasks run `ssh $PVE pct exec $SBX -- ...`.

- [ ] **Step 1: Confirm the Proxmox host is reachable**

Run: `ssh -o ConnectTimeout=8 -o BatchMode=yes root@192.168.1.190 'hostname; pveversion'`
Expected: a hostname and a `pve-manager/...` line. If it times out, the Mac is off the office network; stop and tell the user.

- [ ] **Step 2: Pick a free container ID and read LX120's settings to mirror**

```bash
ssh $PVE 'pvesh get /cluster/nextid; pct config 120 | grep -E "^(net0|features|ostype|unprivileged|arch)"; pveam list local | grep -i debian-12 || true'
```

Record the next free ID as `SBX`. Record LX120's `net0` bridge name (for example `bridge=vmbr0`) and its `features` line (Docker inside an LXC needs `nesting=1`; LX120's line is the known-good value).

- [ ] **Step 3: Make sure a Debian 12 template exists, then create the container**

```bash
ssh $PVE 'pveam list local | grep -q debian-12-standard || { pveam update && T=$(pveam available --section system | awk "/debian-12-standard/{print \$2}" | tail -1) && pveam download local "$T"; }; pveam list local | grep debian-12-standard'
```

Then, substituting the template path printed above and the bridge from Step 2:

```bash
ssh $PVE "pct create $SBX local:vztmpl/<debian-12-standard file> \
  --hostname payroll-build-sandbox \
  --description 'TEMPORARY: payroll container-diet build sandbox, created 2026-10-06. Safe to destroy. See docs/superpowers/plans/2026-10-06-container-diet.md Task 8.' \
  --cores 4 --memory 8192 --swap 2048 \
  --rootfs local-lvm:30 \
  --net0 name=eth0,bridge=<bridge>,ip=dhcp \
  --features nesting=1,keyctl=1 \
  --unprivileged 1 --onboot 0 && pct start $SBX"
```

`--onboot 0` so it never comes back by itself after a host reboot.

- [ ] **Step 4: Install Docker and record the IP**

```bash
ssh $PVE "pct exec $SBX -- bash -c 'apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg git && install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && echo \"deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable\" > /etc/apt/sources.list.d/docker.list && apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && docker run --rm hello-world | grep Hello && hostname -I'"
```

Expected: `Hello from Docker!` and an IP. Record the IP as `SBX_IP`. If `docker run` fails with a permissions or overlay error, the `features` line needs to match LX120's exactly (Step 2); fix with `pct set $SBX --features <LX120 value>` and `pct reboot $SBX`.

- [ ] **Step 5: Ship the repo as a git bundle**

On the Mac, from the repo root:

```bash
git bundle create /tmp/payroll.bundle rebuild/foundation
scp /tmp/payroll.bundle $PVE:/tmp/payroll.bundle
ssh $PVE "pct push $SBX /tmp/payroll.bundle /tmp/payroll.bundle && pct exec $SBX -- bash -c 'git clone -q -b rebuild/foundation /tmp/payroll.bundle /opt/payroll && cd /opt/payroll && git log --oneline -1' && rm /tmp/payroll.bundle"
```

Expected: the local HEAD's one-line log.

- [ ] **Step 6: Write the sandbox `.env` with throwaway secrets**

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && umask 077 && cat > .env <<EOF
POSTGRES_PASSWORD=\$(openssl rand -hex 16)
AUTH_SECRET=\$(openssl rand -base64 48 | tr -d \"\\n\")
NGTECO_VAULT_KEY=\$(openssl rand -base64 32 | tr -d \"\\n\")
MCP_SERVICE_TOKEN=\$(openssl rand -base64 48 | tr -d \"\\n\")
APP_URL=http://$SBX_IP:3000
OWNER_EMAIL=owner@example.com
EOF
grep -c = .env'"
```

Expected: `6`. These values exist only in the sandbox and die with it.

---

### Task 2: Baseline image and the verification script

The verification script is this plan's test suite. It is written first and run against the current, known-good image, so that a failure later means the new image is wrong and not the script.

**Files:**
- Create: `deploy/verify-image.sh`

**Interfaces:**
- Consumes: sandbox from Task 1.
- Produces: `deploy/verify-image.sh [max-size-mb]`, run from the compose project directory on a host where the stack is up. Prints one `PASS`/`FAIL` line per check and exits non-zero if any check fails. Check names: `size`, `node-version`, `health`, `runtime-modules`, `runtime-files`, `sharp`, `chromium`, `reaper`, `tsx-script`, `mcp`, `metrics`, `logs`. Also produces image tag `payroll-app:baseline` in the sandbox.

- [ ] **Step 1: Write `deploy/verify-image.sh`**

```bash
#!/usr/bin/env bash
# In-container checks for the payroll image. Run from the compose project
# directory on a host where `docker compose up -d db app mcp` has finished.
#
#   bash deploy/verify-image.sh [max-size-mb]
#
# Every check exercises something the container must do at runtime that the
# Next.js build cannot prove: packages resolved outside the bundle, system
# binaries the app shells out to, and the headless browser. Health 200 alone
# does not cover any of these.
set -uo pipefail

MAX_MB="${1:-1600}"
fail=0
pass() { echo "PASS  $1${2:+  $2}"; }
bad()  { echo "FAIL  $1${2:+  $2}"; fail=1; }
in_app() { docker compose exec -T app "$@"; }

# size ------------------------------------------------------------------
bytes=$(docker image inspect payroll-app:latest --format '{{.Size}}' 2>/dev/null || echo 0)
mb=$((bytes / 1000000))
if [ "$mb" -gt 0 ] && [ "$mb" -le "$MAX_MB" ]; then pass size "${mb} MB (limit ${MAX_MB})"; else bad size "${mb} MB (limit ${MAX_MB})"; fi

# node-version ----------------------------------------------------------
nv=$(in_app node -p 'process.versions.node.split(".")[0]' 2>/dev/null | tr -d '[:space:]')
[ "$nv" = "24" ] && pass node-version "v$nv" || bad node-version "got '${nv}', want 24"

# health ----------------------------------------------------------------
h=$(in_app node -e 'fetch("http://localhost:3000/api/health").then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log("ERR "+e.message))' 2>/dev/null)
echo "$h" | grep -q '"app":"ok"' && echo "$h" | grep -q '"db":"ok"' && echo "$h" | grep -q '"boss":"ok"' \
  && pass health || bad health "$h"

# runtime-modules: everything loaded outside the webpack bundle ----------
mods='["@react-pdf/renderer","sharp","web-push","pg-boss","postgres","@node-rs/argon2","playwright","drizzle-orm","zod","dotenv","express","@modelcontextprotocol/sdk/server/mcp.js","@modelcontextprotocol/sdk/server/streamableHttp.js","@opentelemetry/sdk-node","@opentelemetry/resources","@opentelemetry/exporter-prometheus","@opentelemetry/exporter-trace-otlp-http","@opentelemetry/instrumentation-http","@opentelemetry/instrumentation-pg"]'
out=$(in_app node -e "(async()=>{const bad=[];for(const m of ${mods}){try{await import(m)}catch(e){bad.push(m+': '+String(e.message).split('\n')[0])}}console.log(bad.length?bad.join(' | '):'OK')})()" 2>&1)
[ "$out" = "OK" ] && pass runtime-modules || bad runtime-modules "$out"

# runtime-files: paths the code reads by name ----------------------------
out=$(in_app sh -c 'for f in .next/pdf/payslip.js .next/pdf/signature-report.js .next/pdf/admin-report.js .next/pdf/employee-guide.js .next/pdf/payslip-cut-sheet.js .next/pdf/payslip-batch-sheet.js lib/ngteco/selectors.json lib/payroll/pdf-rebuild-seed.json mcp-server/run.cjs node_modules/tsx/dist/cli.mjs scripts/migrate.ts scripts/seed.ts drizzle/meta/_journal.json .git-sha server.js; do [ -e "/app/$f" ] || echo "missing:$f"; done' 2>&1)
[ -z "$out" ] && pass runtime-files || bad runtime-files "$(echo "$out" | tr '\n' ' ')"

# sharp: actually encode a PNG (libvips binary for this platform) --------
out=$(in_app node -e 'require("sharp")({create:{width:8,height:8,channels:4,background:"#067049"}}).png().toBuffer().then(b=>console.log(b.subarray(1,4).toString()+" "+b.length)).catch(e=>console.log("ERR "+e.message))' 2>&1)
echo "$out" | grep -q '^PNG ' && pass sharp "$out" || bad sharp "$out"

# chromium: launch the headless shell the scraper uses, render a page ----
out=$(in_app node -e '(async()=>{const {chromium}=require("playwright");const ctx=await chromium.launchPersistentContext("/tmp/verify-profile",{headless:true,viewport:{width:1280,height:900},locale:"en-US"});const p=await ctx.newPage();await p.setContent("<title>verify</title><h1>ok</h1>");const t=await p.title();const png=await p.screenshot();await ctx.close();console.log(t+" "+png.length)})().catch(e=>console.log("ERR "+String(e.message).split("\n")[0]))' 2>&1)
echo "$out" | grep -q '^verify [0-9]' && pass chromium "$out" || bad chromium "$out"

# reaper: an orphaned browser is found by pgrep and removed by pkill -----
out=$(in_app sh -c '
  node -e "(async()=>{const {chromium}=require(\"playwright\");await chromium.launchPersistentContext(\"/tmp/verify-orphan\",{headless:true});setTimeout(()=>{},60000)})()" >/dev/null 2>&1 &
  i=0; while [ $i -lt 20 ]; do n=$(pgrep -f chrome-headless | wc -l); [ "$n" -gt 0 ] && break; i=$((i+1)); sleep 1; done
  before=$(pgrep -f chrome-headless | wc -l)
  pkill -9 -f chrome-headless; sleep 1
  after=$(pgrep -f chrome-headless | wc -l)
  pkill -9 -f verify-orphan >/dev/null 2>&1
  echo "before=$before after=$after"' 2>&1)
case "$out" in
  *"before=0"*|*"not found"*) bad reaper "$out" ;;
  *"after=0"*) pass reaper "$out" ;;
  *) bad reaper "$out" ;;
esac

# tsx-script: the runbook's way of running a repair script ---------------
out=$(in_app node ./node_modules/tsx/dist/cli.mjs scripts/repair-duplicate-punches.ts --dry-run 2>&1 | tail -3)
rc=${PIPESTATUS[0]}
[ "$rc" = "0" ] && pass tsx-script || bad tsx-script "exit $rc: $(echo "$out" | tr '\n' ' ')"

# mcp --------------------------------------------------------------------
st=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q mcp)" 2>/dev/null)
[ "$st" = "healthy" ] && pass mcp || bad mcp "health=${st:-none}"

# metrics: the Prometheus exporter (OpenTelemetry) is listening ----------
out=$(in_app node -e 'fetch("http://localhost:9464/metrics").then(r=>r.text()).then(t=>console.log(t.includes("# HELP")?"OK":"NOHELP")).catch(e=>console.log("ERR "+e.message))' 2>&1)
[ "$out" = "OK" ] && pass metrics || bad metrics "$out"

# logs: nothing failed to resolve since start ----------------------------
out=$(docker compose logs app mcp 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find module|Executable doesn't exist|error while loading shared libraries" | head -3)
[ -z "$out" ] && pass logs || bad logs "$out"

echo "--"
[ "$fail" = "0" ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit "$fail"
```

- [ ] **Step 2: Build the current image in the sandbox and bring the stack up**

Ship the script (the repo in the sandbox predates it), then build from the unchanged Dockerfile:

```bash
git add deploy/verify-image.sh && git commit -q -m "chore(deploy): add image verification script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git bundle create /tmp/payroll.bundle rebuild/foundation && scp /tmp/payroll.bundle $PVE:/tmp/ \
  && ssh $PVE "pct push $SBX /tmp/payroll.bundle /tmp/payroll.bundle && pct exec $SBX -- bash -c 'cd /opt/payroll && git pull -q /tmp/payroll.bundle rebuild/foundation && git log --oneline -1'"
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && BUILD_GIT_SHA=\$(git rev-parse HEAD) docker compose up -d --build db app mcp 2>&1 | tail -5 && docker tag payroll-app:latest payroll-app:baseline && docker images payroll-app'"
```

Only `db app mcp`: the `cadvisor` service is privileged and is not part of what is being changed; `backup` is a stock Postgres image. Expected: `payroll-app` at roughly 4.7 GB, tagged both `latest` and `baseline`.

- [ ] **Step 3: Seed demo data and create two logins**

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && docker compose exec -T app node ./node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts | tail -3 && docker compose exec -T app node -e \"
const postgres=require(\\\"postgres\\\");const {hash}=require(\\\"@node-rs/argon2\\\");
(async()=>{const sql=postgres(process.env.DATABASE_URL,{max:1});const h=await hash(\\\"Passw0rd!demo\\\");
await sql\\\`insert into users (email,password_hash,role) values (\\\${\\\"owner@example.com\\\"},\\\${h},\\\${\\\"OWNER\\\"}) on conflict do nothing\\\`;
const [e]=await sql\\\`select id from employees where display_name=\\\${\\\"Marcus Brown\\\"}\\\`;
await sql\\\`insert into users (email,password_hash,role,employee_id) values (\\\${\\\"marcus@example.com\\\"},\\\${h},\\\${\\\"EMPLOYEE\\\"},\\\${e.id}) on conflict do nothing\\\`;
console.log(await sql\\\`select email,role from users\\\`);await sql.end()})()\"'"
```

Expected: `Demo seed complete.` and two user rows. If the quoting fights back, write the same script to a file with `pct push` and run it with `node`; the SQL is what matters.

- [ ] **Step 4: Run the verification script against the baseline (expect exactly one failure)**

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && bash deploy/verify-image.sh 1600'"
```

Expected: `FAIL  size  ~4770 MB (limit 1600)` and `PASS` on every other line. This is the failing test. If any other check fails on the known-good image, the script is wrong: fix the script, not the image, and re-run until `size` is the only failure. Record the full output.

- [ ] **Step 5: Commit any script fixes**

```bash
git add deploy/verify-image.sh && git commit -q -m "chore(deploy): verification script fixes from the baseline run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

### Task 3: The lean image

**Files:**
- Modify: `Dockerfile` (stage 1 gains a sibling `prod-deps` stage; stage 2 gains the MCP compile; stage 3 is replaced)
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `deploy/verify-image.sh` and `payroll-app:baseline` from Task 2.
- Produces: an image where every `verify-image.sh` check passes, including `size`. Tagged `payroll-app:diet` in the sandbox.

- [ ] **Step 1: Move `tsx` to runtime dependencies**

```bash
npm install --save-prod --save-exact=false tsx@^4.19.2
git diff --stat package.json package-lock.json
grep -n '"tsx"' package.json
```

Expected: `"tsx": "^4.19.2"` now appears under `dependencies` and not under `devDependencies`. The lockfile diff should be small (the `dev: true` markers on tsx and its dependencies disappear); if it rewrites unrelated versions, discard it (`git checkout package.json package-lock.json`) and make the move by hand: cut the line from `devDependencies`, paste it into `dependencies` in alphabetical position, then `npm install --package-lock-only`.

- [ ] **Step 2: Add the `prod-deps` stage**

In `Dockerfile`, directly after the end of the `deps` stage (after its `RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi` line), insert:

```dockerfile

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1b: prod-deps
# ──────────────────────────────────────────────────────────────────────────────
# Production dependencies only. This is what the runtime image ships. The
# full install above stays for the build stage (typescript, eslint, vitest,
# esbuild); copying THAT tree into the runtime image cost 1.14 GB.
#
# Same base and build tools as `deps` so native modules resolve identically.
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates python3 build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force
```

- [ ] **Step 3: Move the MCP compile into the build stage**

In the `build` stage, directly after the `RUN npx --yes esbuild lib/pdf/payslip.tsx ...` block (the one ending `&& ls -la /app/.next/pdf/`), insert:

```dockerfile

# Bundle the MCP server here, where esbuild is installed. It used to run in
# the runtime stage, which was the only reason that stage needed a
# developer tool. Output path and flags are unchanged.
RUN npx esbuild mcp-server/src/index.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=cjs \
    --outfile=mcp-server/run.cjs \
    --tsconfig=mcp-server/tsconfig.json \
    --packages=external \
    --alias:@/lib=./lib
```

- [ ] **Step 4: Replace the runtime stage**

Replace everything from the `# Stage 3: run` banner's opening rule line through the `--alias:@/lib=./lib` line of the old runtime-stage `RUN npx esbuild` block with the following. Leave the lines after it (`# Default storage root`, `RUN mkdir -p /data/...`, `VOLUME`, `EXPOSE`, the legacy-import comment and `CMD`) exactly as they are.

```dockerfile
# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: run
# ──────────────────────────────────────────────────────────────────────────────
# Slim Node plus exactly one browser. The previous base was Microsoft's
# Playwright image, which ships Chromium, Firefox AND WebKit (2.3 GB); the
# scraper only ever launches Chromium headless.
#
# Node 24 on purpose: that is what the Playwright image ran, so the runtime
# Node major is unchanged.
FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# procps provides pgrep/pkill, which lib/ngteco/chromium-reaper.ts shells
# out to. The old base happened to include it. Without it the reaper fails
# SILENTLY (it swallows the error and reports zero browsers), so orphaned
# headless Chromes would pile up again.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

# Production node_modules first: this layer and the browser layer below only
# change when package-lock.json changes, so routine deploys reuse both.
COPY --from=prod-deps /app/node_modules ./node_modules

# Install the browser FROM the app's own playwright package, so the browser
# build always matches the library. (The old base needed its image tag
# bumped in lockstep with package.json by hand.) --only-shell installs the
# headless shell, the binary `headless: true` launches; its process name is
# what the reaper matches. --with-deps pulls the system libraries Playwright
# lists for this distribution.
RUN node node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*

# Stamped at build time by deploy/lxc/payroll-deploy.service. Used by
# instrumentation.ts to emit milo_build_info{sha,branch,version} so the
# Grafana CI/CD section shows what's running without scraping git.
ARG BUILD_GIT_SHA=dev
ARG BUILD_GIT_BRANCH=unknown
ENV BUILD_GIT_SHA=$BUILD_GIT_SHA
ENV BUILD_GIT_BRANCH=$BUILD_GIT_BRANCH

# Copy the standalone bundle and static files from the build stage.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Carry the SHA stamp into the runtime image. Used by the deploy
# drift-detection check AND by lib/telemetry.ts to emit
# milo_build_info{sha,…} for the Grafana CI/CD panel.
COPY --from=build /app/.git-sha /app/.git-sha
# Pre-compiled PDF docs that the publish job dynamic-imports at
# /app/.next/pdf/*.js (see lib/jobs/handlers/payroll-run-publish.ts).
COPY --from=build /app/.next/pdf ./.next/pdf
COPY --from=build /app/public ./public

# Drizzle and the migrate/seed/repair scripts live outside the standalone
# bundle and run through tsx, so their sources ship as-is.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/lib ./lib
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json
# Includes mcp-server/run.cjs, bundled in the build stage.
COPY --from=build /app/mcp-server ./mcp-server
```

Also update the header comment at the top of the file: replace the `run   —` bullet's three lines with

```dockerfile
#   prod-deps — production-only node_modules for the runtime image.
#   run   — the runtime image: slim Node + the standalone bundle + the
#           migrate/seed scripts + production node_modules + the Chromium
#           headless shell (the NGTeco scraper's only browser).
```

Note the one ordering difference from the old stage: `node_modules` is now copied before the standalone bundle instead of after. Both trees are installed from the same lockfile, so any file present in both is identical; the verification run is what confirms it.

- [ ] **Step 5: Local sanity before shipping to the sandbox**

```bash
npm run typecheck && npx vitest run 2>&1 | grep -E "Tests|Test Files"
grep -c "^FROM " Dockerfile
grep -n "mcr.microsoft.com\|COPY --from=build /app/node_modules" Dockerfile
```

Expected: typecheck clean; `361 passed`; `4` FROM lines; the last grep prints nothing.

- [ ] **Step 6: Commit, ship, build**

```bash
git add Dockerfile package.json package-lock.json && git commit -q -m "build(docker): slim Node 24 runtime with the Chromium headless shell only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git bundle create /tmp/payroll.bundle rebuild/foundation && scp /tmp/payroll.bundle $PVE:/tmp/ \
  && ssh $PVE "pct push $SBX /tmp/payroll.bundle /tmp/payroll.bundle && pct exec $SBX -- bash -c 'cd /opt/payroll && git pull -q /tmp/payroll.bundle rebuild/foundation && BUILD_GIT_SHA=\$(git rev-parse HEAD) docker compose up -d --build db app mcp 2>&1 | tail -8 && docker tag payroll-app:latest payroll-app:diet && docker images payroll-app'"
```

Expected: build succeeds; `payroll-app:latest`/`diet` is far smaller than `baseline`. If the Chromium install step fails on a missing package, read the apt error: it names the package. Do not add packages speculatively.

- [ ] **Step 7: Run the verification script (expect all pass)**

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && sleep 45 && bash deploy/verify-image.sh 1600'"
```

Expected: `ALL CHECKS PASSED`, with `size` at or under 1600 MB. Record the full output and the exact size.

If `runtime-modules` fails for a package: that package is in `devDependencies` but used at runtime. Confirm with `grep -n '"<name>"' package.json`, move it to `dependencies` the same way as `tsx` in Step 1, note it in the commit message, and rebuild. If `size` is the only failure and the image is between 1.6 and 2.0 GB, stop and report the measured breakdown (`docker history payroll-app:diet`) to the user instead of cutting anything further; the spec's out-of-scope list forbids removing dependencies in this piece.

- [ ] **Step 8: Commit any follow-up fixes**

```bash
git status --short; git add -A Dockerfile package.json package-lock.json && git commit -q -m "build(docker): fixes from the sandbox verification run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

### Task 4: Phone check and comparison against the baseline

**Files:**
- Create (scratchpad, not the repo): `phone-check.mjs`

**Interfaces:**
- Consumes: sandbox stack running `payroll-app:diet` at `http://$SBX_IP:3000`, with the two logins from Task 2 Step 3; image tag `payroll-app:baseline`.
- Produces: a JSON report and screenshots per image, and a pass/fail comparison.

- [ ] **Step 1: Write `phone-check.mjs` in the session scratchpad**

```js
// usage: node phone-check.mjs <baseUrl> <outDir>
// WebKit with an iPhone profile: the same engine as Safari on the users'
// phones. Checks what a phone actually receives from the server.
import { webkit, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const [base, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await webkit.launch();
const report = { base, results: [], failures: [] };
const note = (name, ok, detail = "") => {
  report.results.push({ name, ok, detail });
  if (!ok) report.failures.push(`${name}: ${detail}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

async function session(email) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.addCookies([{ name: "milo-theme", value: "light", url: base }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("requestfailed", (r) => errors.push(`requestfailed ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Passw0rd!demo");
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
  return { ctx, page, errors };
}

async function visit(s, tag, path) {
  s.errors.length = 0;
  const res = await s.page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 });
  await s.page.waitForTimeout(400);
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - 390);
  const bodyErr = await s.page.evaluate(() => /Application error|server-side exception|Internal Server Error/.test(document.body.innerText));
  await s.page.screenshot({ path: `${outDir}/${tag}${path.replace(/[\/?=&]+/g, "_")}.png`, fullPage: true });
  const ok = res.status() === 200 && overflow <= 0 && !bodyErr && s.errors.length === 0;
  note(`${tag} ${path}`, ok, `http=${res.status()} overflow=${overflow} errors=${s.errors.slice(0, 2).join("; ")}`);
}

async function fetchCheck(s, name, path, want) {
  const r = await s.page.request.get(base + path);
  const buf = await r.body();
  const ct = r.headers()["content-type"] ?? "";
  const ok = r.status() === 200 && ct.includes(want.type) && (!want.magic || buf.subarray(0, want.magic.length).toString("latin1") === want.magic) && buf.length >= (want.min ?? 1);
  note(name, ok, `http=${r.status()} type=${ct} bytes=${buf.length}`);
  return buf;
}

// ── employee ────────────────────────────────────────────────────────────
const emp = await session("marcus@example.com");
for (const p of ["/me/home", "/me/time", "/me/pay", "/me/calendar", "/me/profile"]) await visit(emp, "emp", p);
await fetchCheck(emp, "manifest", "/manifest.webmanifest", { type: "json", min: 50 });
await fetchCheck(emp, "service worker", "/sw.js", { type: "javascript", min: 200 });
await fetchCheck(emp, "icon 192", "/api/branding/icon/192", { type: "image/", min: 100 });
await fetchCheck(emp, "icon 512", "/api/branding/icon/512", { type: "image/", min: 100 });
await emp.ctx.close();

// ── admin ───────────────────────────────────────────────────────────────
const own = await session("owner@example.com");
for (const p of ["/dashboard", "/time", "/payroll", "/reports", "/employees", "/settings/company"]) await visit(own, "admin", p);
// On-demand PDFs: these load @react-pdf/renderer and the pre-compiled
// documents from /app/.next/pdf at request time.
await fetchCheck(own, "pdf employee guide", "/api/guides/employee", { type: "pdf", magic: "%PDF", min: 2000 });
const periodHref = await own.page.evaluate(async () => {
  const html = await (await fetch("/payroll")).text();
  const m = html.match(/\/payroll\/([0-9a-f-]{36})/);
  return m ? m[1] : null;
});
note("found a period id", !!periodHref, String(periodHref));
if (periodHref) {
  await visit(own, "admin", `/payroll/${periodHref}`);
  await fetchCheck(own, "pdf signature report", `/api/payslips/period/${periodHref}/signature`, { type: "pdf", magic: "%PDF", min: 2000 });
  await fetchCheck(own, "pdf cut sheet", `/api/payroll/${periodHref}/payslips-cut-sheet`, { type: "pdf", magic: "%PDF", min: 2000 });
}
await own.ctx.close();

await browser.close();
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
console.log(report.failures.length ? `\n${report.failures.length} FAILURES` : "\nALL PHONE CHECKS PASSED");
process.exit(report.failures.length ? 1 : 0);
```

- [ ] **Step 2: Install WebKit for Playwright on the Mac and run against the new image**

```bash
cd /Users/sahilkhatri/Work/payroll && npx playwright install webkit
cp "$SCRATCH/phone-check.mjs" ./.__phone-check.mjs
node ./.__phone-check.mjs http://$SBX_IP:3000 "$SCRATCH/phone/diet"
```

(`$SCRATCH` is the session scratchpad directory. The script is copied into the repo root only so Node resolves `playwright` from `node_modules`; it is deleted in Step 5 and never committed.)

Expected: `ALL PHONE CHECKS PASSED`. The manifest path is whatever `app/manifest.ts` serves; if `/manifest.webmanifest` returns 404, read the `<link rel="manifest">` href from the `/login` HTML and use that path in both runs.

- [ ] **Step 3: Exercise the publish path once (payslip PDF written by the job queue)**

The demo data has locked periods with no payslips. Publishing one runs the `payroll-run-publish` job, which renders `payslip.js` and `signature-report.js` to disk through pg-boss: the one PDF path Step 2 cannot reach.

In a desktop browser on the Mac, open `http://$SBX_IP:3000`, sign in as `owner@example.com` / `Passw0rd!demo`, open the most recent locked period under Payroll, and press **Publish**. Then:

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && sleep 20 && docker compose exec -T db psql -U payroll -d payroll -Atc \"select count(*), count(pdf_path) from payslips\" && docker compose exec -T app sh -c \"find /data/payslips -name *.pdf | head -3; find /data/payslips -name *.pdf | wc -l\" && docker compose logs --since 3m app 2>&1 | grep -iE \"error|publish\" | tail -5'"
```

Expected: a non-zero payslip count with the same number of `pdf_path` values, PDF files on disk, and no error lines. Then sign in on the phone profile as `marcus@example.com` (re-run Step 2's command; `/me/pay` now lists a payslip) and confirm it still passes.

- [ ] **Step 4: Run the same check against the baseline image and compare**

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && docker tag payroll-app:baseline payroll-app:latest && docker compose up -d --no-build app mcp && sleep 60 && docker compose exec -T app cat /app/.git-sha'"
node ./.__phone-check.mjs http://$SBX_IP:3000 "$SCRATCH/phone/baseline"
python3 - <<'EOF'
import json, os
s = os.environ["SCRATCH"]
a = {r["name"]: r for r in json.load(open(f"{s}/phone/baseline/report.json"))["results"]}
b = {r["name"]: r for r in json.load(open(f"{s}/phone/diet/report.json"))["results"]}
diff = [n for n in sorted(set(a) | set(b)) if a.get(n, {}).get("ok") != b.get(n, {}).get("ok")]
print("DIFFERENCES:", diff or "none")
EOF
```

Expected: `DIFFERENCES: none`. Then compare three screenshot pairs by eye (`emp_me_home`, `emp_me_time`, `admin_time`); they must look the same. Finally put the new image back:

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && docker tag payroll-app:diet payroll-app:latest && docker compose up -d --no-build app mcp && sleep 60 && bash deploy/verify-image.sh 1600 | tail -3'"
```

Expected: `ALL CHECKS PASSED`.

- [ ] **Step 5: Remove the temporary script from the repo root**

```bash
rm -f ./.__phone-check.mjs && git status --short
```

Expected: no output.

---

### Task 5: Deploy unit — rollback tag and cache cap

**Files:**
- Modify: `deploy/lxc/payroll-deploy.service` (the `ExecStart` block)
- Modify: `docs/runbook.md` (new section after "Manual rebuild")

**Interfaces:**
- Consumes: sandbox with the repo and a working stack.
- Produces: after any rebuild, image tag `payroll-app:previous` holds the image that was running before it.

- [ ] **Step 1: Edit the unit**

In `deploy/lxc/payroll-deploy.service`, replace the two `if`/`elif` branch bodies and add the comment, so the block from `if [ "$before" != "$after" ]; then` to the closing `fi'` reads:

```ini
  if [ "$before" != "$after" ]; then \
    echo "deploying $before -> $after"; \
    /usr/bin/docker tag payroll-app:latest payroll-app:previous 2>/dev/null || true; \
    /usr/bin/docker compose up -d --build --remove-orphans; \
    /usr/bin/docker image prune -f >/dev/null 2>&1 || true; \
    (/usr/bin/docker builder prune -f --max-used-space 2gb || /usr/bin/docker builder prune -f --keep-storage 2gb) >/dev/null 2>&1 || true; \
  elif [ -n "$running" ] && [ "$running" != "$after" ]; then \
    echo "container drift detected (running=$running, head=$after) — rebuilding"; \
    /usr/bin/docker tag payroll-app:latest payroll-app:previous 2>/dev/null || true; \
    /usr/bin/docker compose up -d --build --remove-orphans; \
    /usr/bin/docker image prune -f >/dev/null 2>&1 || true; \
    (/usr/bin/docker builder prune -f --max-used-space 2gb || /usr/bin/docker builder prune -f --keep-storage 2gb) >/dev/null 2>&1 || true; \
  else \
    echo "no changes ($after); ensuring services are up"; \
    /usr/bin/docker compose up -d --remove-orphans; \
  fi'
```

And add to the comment block above `ExecStart`:

```ini
# Before a rebuild the current image is tagged payroll-app:previous, so a
# rollback is a retag + restart (see docs/runbook.md "Roll back a deploy")
# instead of another full build. After a successful rebuild, dangling
# images are removed and the build cache is capped at 2 GB; uncapped, it
# grew by gigabytes per deploy until builds failed with "no space left on
# device". Both cleanups are best-effort and can never fail the deploy.
# (The cache flag was renamed between Docker releases, hence the fallback.)
```

Two notes for the reviewer. `docker image prune -f` removes only untagged images; tagged images such as `pre-mount` and `mount-stage` are never touched. It is an addition beyond the spec's wording: without it the image that was `previous` two deploys ago stays on disk untagged forever, which defeats the purpose.

- [ ] **Step 2: Add the rollback section to `docs/runbook.md`**

Insert after the "Manual rebuild" section (after its closing paragraph `The unit is \`Type=oneshot\` so this just runs the cycle once.`):

````markdown
### Roll back a deploy

Every deploy tags the image it replaces as `payroll-app:previous`. To go
back to it:

```
ssh root@192.168.1.190 -t 'pct exec 120 -- bash -lc "
  systemctl stop payroll-deploy.timer &&
  cd /opt/payroll &&
  docker tag payroll-app:previous payroll-app:latest &&
  docker compose up -d --no-build app mcp &&
  docker compose exec -T app cat /app/.git-sha"'
```

The timer must be stopped first: it rebuilds from git whenever the running
SHA differs from the branch head, which would undo the rollback within a
minute. Then revert the bad commit, push, and start the timer again
(`systemctl start payroll-deploy.timer`); the next tick deploys the revert.

A rollback does not touch the database. If the bad deploy ran a migration,
restore from the pre-deploy dump as well (see "Restore drill").
````

- [ ] **Step 3: Test the unit end to end in the sandbox against a local remote**

The sandbox has no GitHub remote, so point `origin` at a bare repo inside it and deploy two commits through the real unit.

```bash
git add deploy/lxc/payroll-deploy.service docs/runbook.md && git commit -q -m "chore(deploy): keep the previous image for rollback, cap the build cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git bundle create /tmp/payroll.bundle rebuild/foundation && scp /tmp/payroll.bundle $PVE:/tmp/ && ssh $PVE "pct push $SBX /tmp/payroll.bundle /tmp/payroll.bundle"
ssh $PVE "pct exec $SBX -- bash -c '
set -e
git clone -q --bare -b rebuild/foundation /tmp/payroll.bundle /srv/origin.git
cd /opt/payroll && git remote remove origin 2>/dev/null; git remote add origin /srv/origin.git
git fetch -q origin rebuild/foundation && git reset -q --hard origin/rebuild/foundation
cp deploy/lxc/payroll-deploy.service /etc/systemd/system/ && systemctl daemon-reload
docker rmi payroll-app:previous 2>/dev/null || true
A=\$(docker image inspect payroll-app:latest --format {{.Id}})
# an empty commit on the remote makes HEAD move, which forces a rebuild
git clone -q /srv/origin.git /tmp/w && cd /tmp/w && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m \"sandbox: force deploy\" && git push -q origin rebuild/foundation
systemctl start payroll-deploy.service
cd /opt/payroll
P=\$(docker image inspect payroll-app:previous --format {{.Id}})
echo \"previous==old-latest: \$([ \"\$A\" = \"\$P\" ] && echo yes || echo NO)\"
journalctl -u payroll-deploy.service -n 4 --no-pager | cut -c1-160
docker compose exec -T app cat /app/.git-sha; echo; git rev-parse HEAD
docker system df | sed -n 1,5p'"
```

Expected: `previous==old-latest: yes`; the unit finished without error; the running SHA equals HEAD; Build Cache is at or under about 2 GB. Note: this deploys `db app mcp backup cadvisor` because the unit runs plain `docker compose up`; if `cadvisor` cannot start in the nested container the unit will fail on it, and that failure is about the sandbox, not the change. In that case re-run with a compose override that drops it: `printf 'services:\n  cadvisor:\n    profiles: ["never"]\n' > /opt/payroll/docker-compose.override.yml` (sandbox only, never committed).

- [ ] **Step 4: Test the rollback procedure and the failed-prune path**

```bash
ssh $PVE "pct exec $SBX -- bash -c '
cd /opt/payroll
docker tag payroll-app:previous payroll-app:latest && docker compose up -d --no-build app mcp >/dev/null 2>&1 && sleep 50
echo rolled-back-sha=\$(docker compose exec -T app cat /app/.git-sha)
curl -s -o /dev/null -w \"health %{http_code}\n\" http://localhost:3000/api/health
# drift (running != HEAD) makes the unit rebuild and move forward again
systemctl start payroll-deploy.service; echo unit-exit=\$?
docker compose exec -T app cat /app/.git-sha; echo'"
```

Expected: after the retag the running SHA is the older commit and health is 200; then the unit (seeing drift) rebuilds, exits 0, and the SHA is HEAD again. For the failed-prune path, temporarily append ` --definitely-not-a-flag` to both `builder prune` invocations in the installed unit copy under `/etc/systemd/system/`, `systemctl daemon-reload`, push another empty commit as in Step 3, and confirm `systemctl start payroll-deploy.service` still exits 0 and the app is healthy. Restore the unit copy afterwards.

- [ ] **Step 5: Final full verification on the sandbox's last-built image**

```bash
ssh $PVE "pct exec $SBX -- bash -c 'cd /opt/payroll && bash deploy/verify-image.sh 1600'"
```

Expected: `ALL CHECKS PASSED`.

---

### Task 6: Documentation and version

**Files:**
- Modify: `docs/spec.md:437`
- Modify: `CLAUDE.md` (new bullet above `- **Bug-fix discipline.**`)
- Modify: `package.json`, `package-lock.json` (version)
- Modify: `docs/superpowers/specs/2026-10-06-container-diet-design.md` (one correction)

- [ ] **Step 1: Keep the product spec true**

In `docs/spec.md`, replace the line

```
- Single Dockerfile, multi-stage, final image bumped by Playwright (~500MB; accepted).
```

with

```
- Single Dockerfile, multi-stage. The runtime image is slim Node plus the Chromium headless shell (the scraper's only browser) and production dependencies only.
```

- [ ] **Step 2: Correct the design spec**

The design names `scripts/repair-orphan-day-pairs.ts --dry-run`, but that script has no dry-run flag. Replace that bullet's script name with `scripts/repair-duplicate-punches.ts --dry-run`, which has one and is what `verify-image.sh` runs.

- [ ] **Step 3: Add the briefing entry to `CLAUDE.md`**

Insert above `- **Bug-fix discipline.**`, filling the three measured values (`<SIZE>`, `<FREE>`, and the date if it differs) from the recorded outputs of Task 3 Step 7 and Task 7 Step 7. Add this entry only after Task 7 has produced those numbers; the entry must not be committed with the angle-bracket markers still in it.

```markdown
- **Container diet (Oct 2026, v1.5.2; covering developer).** The image was 4.77 GB; three of them on LX120's 24 GB disk is why deploys ran out of space. It is now <SIZE>. Where the weight was: the runtime base was Microsoft's Playwright image (2.3 GB: Chromium, Firefox AND WebKit, when the scraper only launches Chromium headless), and the full developer `node_modules` (1.14 GB: typescript, eslint, vite, prettier) was copied over the standalone bundle. Now: `node:24-bookworm-slim` (same Node major the old base ran) + `playwright install --with-deps --only-shell chromium` run from the app's own package, so browser and library can no longer drift; a `prod-deps` stage (`npm ci --omit=dev`) feeds the runtime image; the MCP esbuild step moved to the build stage; `tsx` is a real dependency because the container runs it at every start. **Two things the old base provided by accident and the new one must name:** `procps` (the chrome reaper shells out to `pgrep`/`pkill` and SWALLOWS a missing-binary error, so without it orphaned browsers silently stop being reaped), and the browser's system libraries. `deploy/verify-image.sh` is the regression test for any future Dockerfile or dependency change: it checks size, Node major, health, every package resolved outside the bundle, the files read by path, a real sharp encode, a real headless launch, the reaper, a tsx repair script, MCP health, the metrics port and the logs. Run it from the compose directory on the host. Deploy unit: each rebuild tags the outgoing image `payroll-app:previous` (rollback = retag + `compose up --no-build`, timer stopped first; see the runbook), removes dangling images, and caps the build cache at 2 GB. Verified before production in a throwaway Proxmox LXC (since destroyed) against the old image as a baseline, including a WebKit/iPhone-profile pass over the employee and admin routes and the on-demand PDFs. Free disk on LX120 after: <FREE>. If a dependency is ever needed at runtime but only present in `devDependencies`, `verify-image.sh`'s `runtime-modules` check is where it shows up. NOT done here, by decision: removing unused dependencies (next refactor piece), running as non-root, splitting the browser into its own service.
```

- [ ] **Step 4: Bump the version**

```bash
npm version 1.5.2 --no-git-tag-version && grep -n '"version"' package.json | head -1
```

Expected: `"version": "1.5.2"`. A patch bump: no feature, behaviour unchanged.

- [ ] **Step 5: Commit (spec, design correction and version now; the `CLAUDE.md` entry is committed in Task 7 Step 8)**

```bash
git add docs/spec.md docs/superpowers/specs/2026-10-06-container-diet-design.md package.json package-lock.json && git commit -q -m "docs: spec image line, design correction; v1.5.2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git status --short
```

---

### Task 7: Production rollout

**Stop before this task and get the user's explicit go-ahead.** Report the sandbox results first: measured size, the full `verify-image.sh` output, the phone-check result, the baseline comparison.

**Files:** none new.

- [ ] **Step 1: Pre-flight on LX120**

```bash
ssh $PVE "pct exec 120 -- bash -c 'df -h / | tail -1; docker system df | sed -n 1,5p; docker images payroll-app; cd /opt/payroll && docker compose exec -T app cat /app/.git-sha; echo; systemctl is-active payroll-deploy.timer; date -u +%H:%M'"
```

If free space is under 7 GB, ask the user before running `docker builder prune -af` (as on 2026-10-06). If the minute is past `:45`, wait until after the hourly poll at `:00` completes.

- [ ] **Step 2: Database dump**

```bash
ssh $PVE "pct exec 120 -- bash -c 'cd /opt/payroll && TS=\$(date -u +%Y%m%dT%H%M%SZ) && docker compose exec -T db pg_dump -U payroll -d payroll --format=custom > data/backups/payroll-predeploy-v1.5.2-\$TS.dump && ls -la data/backups/payroll-predeploy-v1.5.2-\$TS.dump'"
```

Expected: a non-empty file. There is no migration in this deploy; the dump is a precaution.

- [ ] **Step 3: Stop the timer, install the new unit, start the timer**

The unit must be in place before the push so that this deploy is the one that creates `payroll-app:previous`.

```bash
scp deploy/lxc/payroll-deploy.service $PVE:/tmp/payroll-deploy.service
ssh $PVE "pct push 120 /tmp/payroll-deploy.service /tmp/payroll-deploy.service.new && pct exec 120 -- bash -c '
systemctl stop payroll-deploy.timer &&
cp -p /etc/systemd/system/payroll-deploy.service /etc/systemd/system/payroll-deploy.service.bak-pre-diet &&
cp /tmp/payroll-deploy.service.new /etc/systemd/system/payroll-deploy.service &&
systemctl daemon-reload && systemd-analyze verify /etc/systemd/system/payroll-deploy.service; cat /etc/systemd/system/payroll-deploy.service.d/override.conf'"
```

Expected: no verify errors; the override still names `PAYROLL_BRANCH=rebuild/foundation`. The timer stays stopped; `deploy.sh` triggers the service directly.

- [ ] **Step 4: Deploy**

```bash
./deploy.sh
```

This pushes to GitHub and runs the deploy unit. The build is a full rebuild with a cold cache; allow 15 minutes (run it in the background and wait for it to finish; do not start a second deploy). Expected final line: `Deployed and verified: <sha> (health OK)`.

If the build fails: the old container is still running and untouched (`docker compose up --build` only replaces it after a successful build). Read `journalctl -u payroll-deploy.service -n 60`, report to the user, and do not retry blindly.

- [ ] **Step 5: Verify on production**

```bash
ssh $PVE "pct exec 120 -- bash -c 'cd /opt/payroll && bash deploy/verify-image.sh 1600; docker images payroll-app; systemctl start payroll-deploy.timer; systemctl is-active payroll-deploy.timer'"
```

Expected: `ALL CHECKS PASSED`; `payroll-app:previous` exists at about 4.77 GB; the timer is active. The `reaper` check kills headless browsers inside the app container, which is safe because nothing launches one outside a poll fallback, a manual-punch sync or a manual import; run this step when no manual import is in progress.

Then the phone check against production's public URL is not possible without real credentials, so ask the user to open the app on an iPhone, sign in, and open a payslip.

- [ ] **Step 6: The NGTeco browser path, with real credentials**

Ask the user to press the roster-sync or "Test connection" control on `/settings/ngteco` (read-only against NGTeco), or do it for them only if they say so. Then:

```bash
ssh $PVE "pct exec 120 -- bash -c 'cd /opt/payroll && docker compose logs --since 10m app 2>&1 | grep -iE \"ngteco|chrom|playwright|Executable\" | tail -15'"
```

Expected: a completed run and no `Executable doesn't exist` or shared-library error.

- [ ] **Step 7: Watch the next hourly poll and record the disk**

After the next `:00`:

```bash
ssh $PVE "pct exec 120 -- bash -c 'cd /opt/payroll && docker compose exec -T db psql -U payroll -d payroll -Atc \"select started_at, finished_at, ok from ngteco_poll_log order by started_at desc limit 2\"; df -h / | tail -1; docker system df | sed -n 1,5p'"
```

Expected: the newest poll row started after the deploy, finished, `ok = t`. Record the free-disk figure.

- [ ] **Step 8: Commit and push the briefing entry**

Fill `<SIZE>` and `<FREE>` in the `CLAUDE.md` entry from Task 6 Step 3, then:

```bash
grep -c "<SIZE>\|<FREE>" CLAUDE.md   # must print 0
git add CLAUDE.md && git commit -q -m "docs: container diet briefing entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

A docs-only push still triggers a rebuild on LX120 (HEAD moves). It is now a cached, small build, and it doubles as the proof that a routine deploy works on the new image and that `previous` rotates. Ask the user whether to push now or let it ride with the next change; either is fine.

---

### Task 8: Destroy the sandbox

Do this once Task 7 has passed (or the user has decided to abandon the work). It is not optional.

- [ ] **Step 1: Stop and destroy**

```bash
ssh $PVE "pct config $SBX | grep -E 'hostname|description'"
```

Confirm the hostname is `payroll-build-sandbox` before the next command. Destroying the wrong ID on this host would take down someone else's service.

```bash
ssh $PVE "pct stop $SBX && pct destroy $SBX --purge 1 && rm -f /tmp/payroll.bundle /tmp/payroll-deploy.service"
```

- [ ] **Step 2: Confirm it is gone**

```bash
ssh $PVE "pct list | grep -c payroll-build-sandbox; lvs | grep -c vm-$SBX-disk; pvesm status | grep local-lvm"
```

Expected: `0`, `0`, and `local-lvm` usage back to about what it was before Task 1.

- [ ] **Step 3: Clean up the Mac**

```bash
rm -f /tmp/payroll.bundle /tmp/payroll-deploy-verify.out
```

Leave the downloaded Debian template on the Proxmox host only if it was already there before Task 1 Step 3; if this plan downloaded it, remove it with `pveam remove local:vztmpl/<file>`.

- [ ] **Step 4: Update the saved memory note**

Update `lx120-deploy-disk-full.md` in the memory directory with the new image size, the free-disk figure, and that the deploy unit now caps its own cache, so the "clear the build cache before each deploy" instruction no longer applies.

---

## Self-Review Notes

- **Spec coverage:** image changes (Task 3); `procps` and Chromium (Task 3, checked in Task 2's script); deploy unit and rollback (Task 5); sandbox lifecycle (Tasks 1 and 8); sandbox verification items 1-8 (Tasks 2, 3, 4; item 8 in Task 3 Step 5); production checks 1-6 (Task 7 Steps 4-7); rollout order (Task 7). The spec's "employee guide PDF", "signature report" and "cut sheet" are in the phone check; "a payslip PDF is generated" is Task 4 Step 3; "signature PNG passes validation (sharp)" is covered by the `sharp` encode check rather than the signing UI, because the kiosk signing flow needs a published payslip and a PIN session; the library and its native binary are what the image change can affect.
- **One deliberate addition beyond the spec:** `docker image prune -f` in the deploy unit (Task 5 Step 1), explained there.
- **One spec correction:** the dry-run script name (Task 6 Step 2).
