import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    // Auto JSX runtime so test files can use JSX without `import React`.
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/db/schema.ts", "**/*.test.*", "**/__fixtures__/**"],
      thresholds: {
        // Phase 1: the pay-calc primitives are the heart of the system.
        // Anything < 100% means there's a corner case we don't actually trust.
        "lib/payroll/**/*.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Phase 2: the NGTeco CSV parser has the same bar — it shapes
        // every Punch we ingest and a wrong dedupe hash silently doubles pay.
        "lib/ngteco/parser.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
