// Database client. One per process.
//
// We use postgres.js (no pg) because it plays nicely with serverless and Edge,
// and Drizzle's adapter for it is the most stable. pg-boss runs alongside on
// the same database (different schema) — see /lib/jobs.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and configure it.",
  );
}

// Single connection pool for the app. pg-boss uses its own pool.
//
// `prepare: false` because Next.js may run this in environments where prepared
// statements are unwelcome (PgBouncer transaction pooling, etc). Drizzle handles
// query construction; the perf hit is negligible for our workload.
const client = postgres(databaseUrl, {
  max: 10,
  idle_timeout: 30,
  prepare: false,
});

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
