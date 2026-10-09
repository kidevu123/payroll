# syntax=docker/dockerfile:1.7
# Multi-stage build for the payroll app.
#
# Stages:
#   manifests — package.json + lockfile with the version pinned to a constant,
#           so a version bump alone does not invalidate the deps stages.
#   deps  — install full deps with native modules (argon2, postgres.js).
#   build — compile Next.js with output: standalone.
#   prod-deps — production-only node_modules.
#   runtime-modules / standalone — prod-deps merged with the few packages
#           only Next's trace has; the bundle without its duplicate copy.
#   run   — the runtime image: slim Node + the standalone bundle + the
#           migrate/seed scripts + production node_modules + the Chromium
#           headless shell (the NGTeco scraper's only browser).

# ──────────────────────────────────────────────────────────────────────────────
# Stage 0: manifests
# ──────────────────────────────────────────────────────────────────────────────
# Every commit bumps "version" in package.json and package-lock.json. Copying
# those files straight into the deps stages changed their cache key on every
# deploy, so both `npm ci` passes (and everything built on their output, down
# to the Chromium download in the run stage) re-ran each time although no
# dependency had changed. This stage rewrites the version to a constant; the
# deps stages copy the result, and BuildKit keys a COPY --from on file
# CONTENT, so they are rebuilt only when a dependency really changes. The
# build stage still gets the real package.json through `COPY . .`.
FROM node:22-bookworm-slim AS manifests
WORKDIR /manifests
COPY package.json package-lock.json* ./
RUN node -e 'const fs=require("fs");const fix=(f,e)=>{if(!fs.existsSync(f))return;const j=JSON.parse(fs.readFileSync(f,"utf8"));e(j);fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")};fix("package.json",j=>{j.version="0.0.0"});fix("package-lock.json",j=>{j.version="0.0.0";if(j.packages&&j.packages[""])j.packages[""].version="0.0.0"})'

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: deps
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Native deps for @node-rs/argon2 and pg-boss's pg client.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates python3 build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=manifests /manifests/ ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

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

COPY --from=manifests /manifests/ ./
# @next/swc-* is the SWC compiler binary (137 MB). Only `next build` and
# `next dev` load it; the build stage has its own copy and the running
# server never touches it.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force \
    && rm -rf node_modules/@next/swc-*

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: build
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# git is needed for `git rev-parse HEAD` below — the SHA gets baked into
# NEXT_PUBLIC_GIT_SHA so the footer can show the running commit.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stamp the build with the git SHA + UTC timestamp. .git is in the build
# context (see .dockerignore); if missing for any reason, fall back to
# "unknown" rather than failing the build.
#
# The SHA is also written to /app/.git-sha so the deploy script can
# compare the RUNNING container's SHA against git HEAD — without that,
# a single failed build leaves the timer in "no changes" mode forever
# (it compares HEAD-before-fetch vs HEAD-after-reset, both equal once
# the failed reset already landed). See deploy/lxc/payroll-deploy.service.
# The cache mount keeps Next's compiler cache (.next/cache) between builds.
# It lives in the build cache, not in any image layer, so it does not grow
# the image and it is not part of the standalone output.
RUN --mount=type=cache,target=/app/.next/cache \
    GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown) \
    && BUILD_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
    && echo "Building $GIT_SHA at $BUILD_AT" \
    && NEXT_PUBLIC_GIT_SHA=$GIT_SHA NEXT_PUBLIC_BUILD_AT=$BUILD_AT \
       npm run build \
    && echo "$GIT_SHA" > /app/.git-sha

# Pre-compile the PDF documents to plain JS at a stable path. The
# publish-job handler dynamically imports them at runtime via
# /* webpackIgnore: true */ "/app/.next/pdf/*.js". They can't be
# webpack-bundled because @react-pdf/renderer imports React hooks
# that the RSC-mode bundle of `react` doesn't expose (useState/useRef
# etc. fail at build time). Compiling them as a side-step keeps the
# job handler in the bundle while the PDF docs sit at a known
# runtime-resolvable absolute path.
RUN npx --yes esbuild lib/pdf/payslip.tsx lib/pdf/signature-report.tsx lib/pdf/admin-report.tsx lib/pdf/employee-guide.tsx lib/pdf/payslip-cut-sheet.tsx lib/pdf/payslip-batch-sheet.tsx \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=cjs \
    --jsx=automatic \
    --outdir=/app/.next/pdf \
    --out-extension:.js=.js \
    && ls -la /app/.next/pdf/

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

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2b: runtime-modules + standalone
# ──────────────────────────────────────────────────────────────────────────────
# The standalone bundle carries its own node_modules: the ~3,500 files
# Next.js traced as needed by the server. Almost all of them are also in the
# production install, so shipping both stored ~100 MB twice. But NOT all:
# six packages (typescript, source-map, source-map-support, buffer-from,
# has-flag, supports-color) are traced by Next yet absent from an
# --omit=dev install, so the traced copy cannot simply be dropped.
#
# So: merge. Start from the production install and add only what it lacks
# (`cp -n` never overwrites), then ship the bundle without its node_modules.
# Where both trees have a file the production install wins, which is the
# precedence the image has always had.
FROM prod-deps AS runtime-modules
COPY --from=build /app/.next/standalone/node_modules /tmp/traced
RUN cp -an /tmp/traced/. /app/node_modules/ && rm -rf /tmp/traced

FROM build AS standalone
RUN rm -rf /app/.next/standalone/node_modules

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

# node_modules first: this layer and the browser layer below only change
# when package-lock.json (or the set of files Next traces) changes, so
# routine deploys reuse both.
COPY --from=runtime-modules /app/node_modules ./node_modules

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

# The standalone bundle (minus its node_modules, merged above) and static
# files.
COPY --from=standalone /app/.next/standalone ./
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

# Default storage root — host-mounted in compose.
RUN mkdir -p /data/uploads /data/payslips /data/ngteco /data/backups
VOLUME ["/data"]

EXPOSE 3000

# Migrate + seed only. The legacy-import script used to run here too,
# but it RE-CREATES periods on every restart from whatever it finds in
# /data/legacy — that resurrected periods the owner had explicitly
# deleted from /payroll. Keep the script in the image but trigger it
# manually when needed:
#   docker compose exec -T app node ./node_modules/tsx/dist/cli.mjs \
#     scripts/import-legacy.ts --apply
CMD ["sh", "-c", "node ./node_modules/tsx/dist/cli.mjs scripts/migrate.ts && node ./node_modules/tsx/dist/cli.mjs scripts/seed.ts && node server.js"]
