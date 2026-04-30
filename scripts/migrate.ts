// Apply pending Drizzle migrations.
//
// Usage:
//   pnpm db:migrate
//
// Behavior:
//   1. Ensure the citext extension is installed (idempotent).
//   2. Run drizzle-kit's migrator against /drizzle.
//   3. Exit non-zero on failure so docker-compose dependency ordering catches it.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });

  try {
    // Required extensions before migrations can land columns that use them.
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS citext;");
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    const db = drizzle(sql);
    try {
      await migrate(db, { migrationsFolder: "./drizzle" });
      console.log("Migrations applied.");
    } catch (err) {
      // If the folder is empty (first-run before `npm run db:generate` has been
      // executed), drizzle-kit/migrator throws — that's a setup issue, not a
      // runtime crash, so call it out clearly.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT") || msg.includes("no migrations")) {
        console.error(
          "No migrations found. Run `npm run db:generate` once locally and commit the generated SQL under /drizzle.",
        );
        process.exit(1);
      }
      throw err;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
