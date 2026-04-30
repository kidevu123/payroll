// Database client. One per process.
//
// We use postgres.js (no pg) because it plays nicely with serverless and Edge,
// and Drizzle's adapter for it is the most stable. pg-boss runs alongside on
// the same database (different schema) — see /lib/jobs.
//
// Lazy: the connection pool is created on first use so the module can be
// imported during `next build` without a live database (Next.js statically
// analyses route handlers and page modules at build time).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

function init() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure it.",
    );
  }
  // Single connection pool for the app. pg-boss uses its own pool.
  //
  // `prepare: false` because Next.js may run this in environments where prepared
  // statements are unwelcome (PgBouncer transaction pooling, etc). Drizzle handles
  // query construction; the perf hit is negligible for our workload.
  const client = postgres(url, { max: 10, idle_timeout: 30, prepare: false });
  return drizzle(client, { schema });
}

export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_t, prop, recv) {
      cached ??= init();
      return Reflect.get(cached, prop, recv);
    },
  },
);

export { schema };
export type Db = typeof db;
