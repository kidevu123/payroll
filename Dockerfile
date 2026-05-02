# syntax=docker/dockerfile:1.7
# Multi-stage build for the payroll app.
#
# Stages:
#   deps  — install full deps with native modules (argon2, postgres.js).
#   build — compile Next.js with output: standalone.
#   run   — the runtime image: minimal Node + the standalone bundle +
#           the migrate script + the seed script + Playwright dependencies.
#           Playwright is baked in now (Phase 2 uses it) so we don't have to
#           rebuild later when the scraper lands.

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: deps
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Native deps for @node-rs/argon2 and pg-boss's pg client.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates python3 build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

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
RUN GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown) \
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
RUN npx --yes esbuild lib/pdf/payslip.tsx lib/pdf/signature-report.tsx \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=cjs \
    --jsx=automatic \
    --outdir=/app/.next/pdf \
    --out-extension:.js=.js \
    && ls -la /app/.next/pdf/

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: run
# ──────────────────────────────────────────────────────────────────────────────
# Use Microsoft's Playwright image as the runtime base — Phase 2 needs it and
# baking it in now avoids a rebuild later. It's larger (~500MB) but the spec
# explicitly accepts that (§19).
FROM mcr.microsoft.com/playwright:v1.48.2-jammy AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the standalone bundle and static files from the build stage.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Pre-compiled PDF docs that the publish job dynamic-imports at
# /app/.next/pdf/*.js (see lib/jobs/handlers/payroll-run-publish.ts).
COPY --from=build /app/.next/pdf ./.next/pdf
COPY --from=build /app/public ./public

# Drizzle and the migrate/seed scripts live outside the standalone bundle.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/lib ./lib
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Default storage root — host-mounted in compose.
RUN mkdir -p /data/uploads /data/payslips /data/ngteco /data/backups
VOLUME ["/data"]

EXPOSE 3000

# Migrate, seed, idempotent legacy import (no-op if /data/legacy is absent),
# then start. compose's healthcheck will hit /api/health.
CMD ["sh", "-c", "node ./node_modules/tsx/dist/cli.mjs scripts/migrate.ts && node ./node_modules/tsx/dist/cli.mjs scripts/seed.ts && node ./node_modules/tsx/dist/cli.mjs scripts/import-legacy.ts --apply && node server.js"]
