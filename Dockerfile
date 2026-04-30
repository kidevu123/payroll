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

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Next (output: standalone) and prepare static assets for the runtime image.
RUN npm run build

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

# Migrate then seed then start. compose's healthcheck will hit /api/health.
CMD ["sh", "-c", "node ./node_modules/tsx/dist/cli.mjs scripts/migrate.ts && node ./node_modules/tsx/dist/cli.mjs scripts/seed.ts && node server.js"]
