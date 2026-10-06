# Container diet — design

Date: 2026-10-06
Status: awaiting review
Author: covering developer, with Claude

This is the first of four planned refactor pieces. The other three
(dependency and leftover cleanup, breaking up the giant files, shared
building blocks) each get their own spec and are out of scope here.

## Goal

Shrink the production image from 4.77 GB to roughly 1.4-1.5 GB without
changing how the app behaves, so that deploys to LX120 stop running out of
disk and a rollback takes seconds.

Success means all of the following:

- The image is at or under 1.6 GB, measured.
- Every check in "Verification" passes in the build sandbox before LX120
  sees the image, and the production checks pass after the deploy.
- No app code, database schema, port, volume, environment variable or
  startup command changes.
- Every command in `docs/runbook.md` works as written.

## Background: where the 4.77 GB comes from

Measured on LX120 from `docker history payroll-app:latest` and `du` inside
the running container, at commit `21fa8ae`:

| Part | Size | Notes |
|---|---|---|
| Playwright base image | about 2.34 GB | Ubuntu jammy, Node 24, Chromium + Firefox + WebKit (`/ms-playwright` is 1.2 GB) |
| `COPY /app/node_modules` | 1.14 GB | the full developer install, copied over the standalone bundle's own traced modules |
| Standalone bundle | 127 MB | |
| Pre-compiled PDF documents | 26 MB | |
| Everything else | under 15 MB | static assets, drizzle, scripts, lib, mcp-server |

Three images of this size sit on a 24 GB disk (`latest`, plus the
maintainer's `pre-mount` and `mount-stage`). A build needs about 6.5 GB of
headroom and the disk has 3.6 GB free, which is why the v1.5.0 deploy failed
once and the v1.5.1 deploy needed the build cache cleared first.

## What the container must still be able to do

These were found by reading the code, not assumed. Each has a matching
verification step.

1. **Run Chromium headless.** `lib/ngteco/scraper.ts` calls
   `chromium.launchPersistentContext(..., { headless: true })` in three
   places. It is still used by: manual-punch write-back to NGTeco
   (`ngteco.manual-punch.sync`), the employee roster sync, "Run import now"
   (`ngteco.import`), and the poll fallback when `NGTECO_FORCE_SCRAPER=1`.
   Firefox and WebKit are never used.
2. **Find and kill stuck browsers.** `lib/ngteco/chromium-reaper.ts` shells
   out to `pgrep -f chrome-headless` and `pkill -9 -f chrome-headless`.
   These binaries come from the `procps` package. The current base image
   happens to include it; a slim Node image does not. Both calls swallow
   errors, so a missing binary would fail silently: the count would read 0
   and orphaned browsers would never be reaped.
3. **Run TypeScript scripts with tsx.** The startup command runs
   `scripts/migrate.ts` and `scripts/seed.ts` through
   `node ./node_modules/tsx/dist/cli.mjs`, and the runbook runs the
   `scripts/repair-*.ts` tools the same way. These import from `lib/`, so
   `lib/`, `scripts/`, `drizzle/`, `tsconfig.json` and `drizzle.config.ts`
   must stay in the image.
4. **Load packages that are resolved at runtime, outside the bundle.**
   `@react-pdf/renderer` (payslip, admin report, cut sheet, batch sheet,
   signature report, employee guide), `sharp` (branding icons, signature
   PNG validation), `web-push`, the OpenTelemetry packages listed as
   externals in `next.config.mjs`, `pg-boss`, `postgres`, `@node-rs/argon2`
   and `playwright`.
5. **Run the MCP server.** `mcp-server/run.cjs` is bundled with
   `--packages=external`, so its dependencies (`express`,
   `@modelcontextprotocol/sdk`, `drizzle-orm`, `postgres`, `zod`, `dotenv`)
   must resolve from `node_modules`.
6. **Read two files by path at runtime.** `lib/ngteco/selectors.json` and
   `lib/payroll/pdf-rebuild-seed.json`, both via `process.cwd()`, and the
   PDF documents at `/app/.next/pdf/*.js`.

## Design

### Image

The `deps` and `build` stages keep their current base
(`node:22-bookworm-slim`) and behaviour. Changes:

- **New `prod-deps` stage.** `npm ci --omit=dev` on the same base as
  `deps`, so native modules are fetched for the same platform as today.
- **`tsx` moves from `devDependencies` to `dependencies`.** The container
  runs it at every start, so it is a runtime dependency. This is the only
  `package.json` change besides the lockfile.
- **MCP compile moves to the `build` stage.** `esbuild` is a developer
  tool; today it runs in the runtime stage, which is the only reason the
  runtime image needs it. The output path (`mcp-server/run.cjs`) and flags
  do not change.
- **Runtime base becomes `node:24-bookworm-slim`.** Node 24 is what
  production runs today (the Playwright image ships it), so the runtime
  Node major does not change.
- **Chromium is installed from the app's own Playwright package:**
  `node node_modules/playwright/cli.js install --with-deps --only-shell chromium`,
  run in the runtime stage after `node_modules` is in place, with
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` set as today. The browser
  version therefore always matches the npm package, which removes the
  "bump the image tag and the dependency in lockstep" hazard the current
  Dockerfile warns about. `--only-shell` installs the headless shell, the
  binary that `headless: true` already uses, whose process name
  (`chrome-headless-shell`) is what the reaper matches.
- **`procps` is installed explicitly**, with `ca-certificates`.
- **The runtime stage copies `node_modules` from `prod-deps`**, not from
  `build`.
- The apt lists and npm cache are removed in the same layers that create
  them.

Unchanged: `WORKDIR`, all `ENV` and `ARG` lines, the SHA stamp, the copied
paths (`.next/standalone`, `.next/static`, `.next/pdf`, `public`,
`drizzle`, `scripts`, `lib`, `drizzle.config.ts`, `tsconfig.json`,
`package.json`, `mcp-server`), the `/data` volume, the exposed port and the
`CMD`.

The image keeps running as root, as it does today. Changing the user is a
separate decision with its own risks (the `/data` bind mount's ownership)
and is out of scope.

### Deploy unit

Two additions to `deploy/lxc/payroll-deploy.service`, which is installed on
LX120 by copying the file and running `systemctl daemon-reload`:

- **Before a rebuild**, tag the image the running app container uses as
  `payroll-app:previous`. If no container is running, skip.
- **After a successful rebuild**, run `docker builder prune -f` with a
  storage cap, so the build cache cannot grow without bound. A failed prune
  must not fail the deploy.

Rollback, documented in `docs/runbook.md`:
`docker tag payroll-app:previous payroll-app:latest`, then
`docker compose up -d --no-build app mcp`. Because the deploy timer would
otherwise rebuild from git within 60 seconds, the documented procedure
stops the timer first and the fix is a `git revert` pushed afterwards.

### Build sandbox

A temporary LXC on the Proxmox host, used only for this work.

- Unprivileged Debian or Ubuntu container with nesting enabled so Docker
  can run inside it, a 30 GB disk on `local-lvm` (about 100 GB free),
  4 cores, 8 GB memory.
- It receives a copy of the repository at the branch under test. It never
  receives `/etc/payroll/.env`, production data, or a database dump. It
  runs its own Postgres with `scripts/seed-demo.ts` data and freshly
  generated throwaway secrets.
- Its ID, creation time and purpose are recorded in the plan. The final
  step of the plan destroys it (`pct stop`, `pct destroy --purge`) and
  confirms it no longer appears in `pct list`.

## Verification

### In the sandbox, before production

Each item is a pass/fail check with the observed output recorded.

1. The image builds, and its size is at or under 1.6 GB.
2. `docker compose up`: migrations apply, seed runs, `/api/health` returns
   `app`, `db` and `boss` all `ok`, and the app container reports healthy.
3. Node reports v24 inside the container.
4. Chromium launches inside the container through Playwright, loads a page,
   and exits. While a browser is deliberately left running, `pgrep -f
   chrome-headless` finds it and `pkill -9 -f chrome-headless` removes it.
5. Runtime-loaded packages, each exercised through the real code path:
   - a payslip PDF is generated and is a valid PDF;
   - the admin signature report and the cut sheet render;
   - the employee guide PDF route returns a PDF;
   - `/api/branding/icon/192` returns a PNG (sharp);
   - a signature PNG passes `lib/payslips/signature-storage.ts` validation
     (sharp);
   - `web-push` loads;
   - the Prometheus endpoint on port 9464 answers (OpenTelemetry);
   - the MCP container reports healthy on `/health`;
   - `scripts/repair-orphan-day-pairs.ts --dry-run` runs to completion
     (tsx, `lib/`, drizzle).
6. Phone check with Playwright's WebKit engine and an iPhone profile, run
   from the developer's Mac against the sandbox: log in as an employee and
   as an admin; fetch the manifest, the icons and `sw.js`; load `/me/home`,
   `/me/time`, `/me/pay`, `/time`, `/payroll`; open a payslip PDF in the
   in-app viewer. No console errors, no failed requests, no horizontal
   overflow.
7. The same phone and admin routes are compared against the current image
   built in the sandbox from the unchanged Dockerfile: identical HTTP
   statuses and no visual difference in screenshots.
8. `npm run typecheck`, `npm run lint` and the unit tests pass.

### In production, after the deploy

1. The deploy script reports the expected SHA and `/api/health` is `ok`.
2. Container logs show no `ERR_MODULE_NOT_FOUND`, `Cannot find module`, or
   `Executable doesn't exist`.
3. The NGTeco employee roster sync is run once. It is read-only and is the
   one check that needs real credentials, so it cannot run in the sandbox.
4. The next hourly punch poll completes normally.
5. A payslip PDF opens for a real period.
6. Free disk on LX120 is recorded.

## Rollout

1. Build and verify in the sandbox.
2. Check free disk on LX120. Clear the build cache first if it is under
   7 GB, with the user's go-ahead as before.
3. Take a database dump, as a precaution; there is no migration.
4. Install the updated deploy unit.
5. Push, away from the top of the hour so the punch poll is not
   interrupted.
6. Run the production checks.
7. Destroy the sandbox.

`payroll-app:previous` will then hold the last 4.77 GB image. It is removed
only when the user says so, as are the maintainer's `pre-mount` and
`mount-stage` images.

## Risks

| Risk | How it is caught or contained |
|---|---|
| Chromium is missing a system library on Debian bookworm | Sandbox check 4; `--with-deps` installs Playwright's own dependency list for the distribution |
| A package that the app needs is only present in the developer install | Sandbox checks 2 and 5 exercise every runtime-loaded package; production check 2 greps the logs |
| `pgrep`/`pkill` missing, reaper silently stops working | `procps` installed explicitly; sandbox check 4 |
| The first build on LX120 is a full rebuild with a cold cache and needs the most disk | Rollout step 2; the new image's layers are far smaller than the old ones |
| The deploy unit change breaks auto-deploy | The unit is tested end to end in the sandbox against a local git remote before it is installed on LX120 |
| A regression is found after deploy | `payroll-app:previous` rollback, seconds |
| Runtime differences between Ubuntu jammy and Debian bookworm | Native modules are already installed on bookworm in the `deps` stage, so the new runtime matches the build more closely than today's does |

## Out of scope

- Removing unused dependencies (the OpenTelemetry packages the unused-code
  scan flagged, and others). This is the next piece.
- Retiring the browser scraper.
- Splitting Chromium into its own service.
- Running the container as a non-root user.
- Growing LX120's disk.
- Removing any existing image on LX120.
