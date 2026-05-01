// Next.js configuration.
// Most behavior lives in /admin/settings; this file is intentionally lean.

import createNextIntlPlugin from 'next-intl/plugin';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const __dirname = dirname(fileURLToPath(import.meta.url));

// OpenTelemetry SDK + auto-instrumentations transitively pull in dozens of
// instrumentation-* and exporter-* packages, all of which use Node-only
// modules (fs, tls, grpc native bindings). Webpack can't bundle them safely;
// they must be left external. Enumerate dynamically so adding/dropping otel
// packages doesn't require updating this list by hand.
//
// `@opentelemetry/api` is excluded: it is small, pure-JS, and bundles fine for
// every runtime. Externalizing it breaks the edge middleware (Edge runtime
// has no CommonJS require).
const OTEL_BUNDLE_SAFE = new Set(['api']);
const otelExternals = (() => {
  try {
    const otelDir = join(__dirname, 'node_modules', '@opentelemetry');
    return readdirSync(otelDir)
      .filter((name) => !OTEL_BUNDLE_SAFE.has(name))
      .map((name) => `@opentelemetry/${name}`);
  } catch {
    return [];
  }
})();

// Packages that must NOT be bundled on the server (they use Node built-ins or
// native bindings). serverExternalPackages alone isn't sufficient for the
// `instrumentation.ts` webpack chain in Next 15.5+, so we also wire them in
// via the explicit `webpack.externals` hook below.
const serverOnlyPackages = [
  'pg-boss',
  'pg',
  'pgpass',
  'pg-connection-string',
  'pg-pool',
  'pg-types',
  'postgres',
  '@node-rs/argon2',
  '@grpc/grpc-js',
  'require-in-the-middle',
  'playwright',
  'playwright-core',
  ...otelExternals,
];

// Match all @opentelemetry/* except `@opentelemetry/api` (bundle-safe; see
// OTEL_BUNDLE_SAFE above for why).
const serverOnlyMatchers = [
  /^@opentelemetry\/(?!api(?:$|\/))/,
  /^@grpc\//,
  /^@node-rs\//,
  /^playwright(?:-core)?(?:$|\/)/,
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server actions are the API layer; allow body up to 5MB for photo upload.
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  // Output standalone bundle so the Dockerfile final stage stays small.
  output: 'standalone',
  serverExternalPackages: serverOnlyPackages,
  webpack(config, { isServer }) {
    if (isServer) {
      const exact = new Set(serverOnlyPackages);
      const externalize = (ctx, cb) => {
        const req = ctx.request;
        if (!req) return cb();
        if (exact.has(req)) return cb(null, `commonjs ${req}`);
        if (serverOnlyMatchers.some((m) => m.test(req))) {
          return cb(null, `commonjs ${req}`);
        }
        return cb();
      };
      config.externals = Array.isArray(config.externals)
        ? [externalize, ...config.externals]
        : [externalize];
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
