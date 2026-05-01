// Apply pending Drizzle migrations.
//
// Usage:
//   pnpm db:migrate
//
// Behavior:
//   1. Ensure required Postgres extensions are installed (idempotent).
//   2. Run drizzle-kit's migrator against /drizzle.
//   3. Idempotently seed default pay schedules (Weekly, Semi-Monthly) so
//      the run-tick job has a target on first boot. Safe to re-run; insert
//      is gated on a name-unique check.
//   4. Exit non-zero on failure so docker-compose dependency ordering catches it.

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

    await seedDefaultPaySchedules(sql);
    await bootstrapZohoFromEnv(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function seedDefaultPaySchedules(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  // Weekly Mon-Sat @ Sunday 7pm ET (matches §21 #6 owner-confirmed default).
  await sql`
    INSERT INTO pay_schedules (name, period_kind, start_day_of_week, cron, active)
    SELECT 'Weekly', 'WEEKLY'::pay_schedule_kind, 1, '0 19 * * 0', true
    WHERE NOT EXISTS (SELECT 1 FROM pay_schedules WHERE name = 'Weekly')
  `;
  // Semi-Monthly: 1-15 and 16-EOM. Cron fires on the 1st and 16th at 7pm ET.
  await sql`
    INSERT INTO pay_schedules (name, period_kind, cron, active)
    SELECT 'Semi-Monthly', 'SEMI_MONTHLY'::pay_schedule_kind, '0 19 1,16 * *', true
    WHERE NOT EXISTS (SELECT 1 FROM pay_schedules WHERE name = 'Semi-Monthly')
  `;
  console.log("Default pay schedules ensured.");
}

/**
 * If the legacy Flask app's ZB_HB_* / ZB_BB_* env vars are present, seal them
 * into a zoho_organizations row so the owner doesn't have to re-enter Zoho
 * credentials in Settings → Zoho on a fresh deploy. Idempotent: existing
 * rows are reused (and only the refresh_token is refreshed if the env value
 * is newer; client_id / client_secret are only seeded once).
 */
async function bootstrapZohoFromEnv(sql: ReturnType<typeof postgres>): Promise<void> {
  const apiDomain = process.env.ZB_DOMAIN ?? "https://www.zohoapis.com";
  const accountsDomain = process.env.ZB_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.com";
  const candidates = [
    { prefix: "ZB_HB", name: "Haute" },
    { prefix: "ZB_BB", name: "Boomin" },
  ];
  // Lazy import so the migrate script doesn't pull lib/* unless we need it.
  const { seal } = await import("../lib/crypto/vault");
  for (const { prefix, name } of candidates) {
    const orgId = process.env[`${prefix}_ORG_ID`];
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
    const refreshToken = process.env[`${prefix}_REFRESH_TOKEN`];
    if (!orgId || !clientId || !clientSecret || !refreshToken) {
      continue;
    }
    const expenseAccountName =
      process.env[`${prefix}_EXPENSE_ACCOUNT_NAME`] ?? "Payroll Expenses";
    const expenseAccountId = process.env[`${prefix}_EXPENSE_ACCOUNT_ID`] ?? null;
    const paidThroughName =
      process.env[`${prefix}_PAID_THROUGH_NAME`] ?? "Operating Account";
    const paidThroughId = process.env[`${prefix}_PAID_THROUGH_ID`] ?? null;
    const vendorId = process.env[`${prefix}_VENDOR_ID`] ?? null;
    const sealedClientId = JSON.stringify(seal(clientId));
    const sealedClientSecret = JSON.stringify(seal(clientSecret));
    const sealedRefresh = JSON.stringify(seal(refreshToken));
    await sql`
      INSERT INTO zoho_organizations (
        name, organization_id, api_domain, accounts_domain,
        client_id_encrypted, client_secret_encrypted, refresh_token_encrypted,
        default_expense_account_name, default_expense_account_id,
        default_paid_through_name, default_paid_through_id,
        default_vendor_id, active
      )
      VALUES (
        ${name}, ${orgId}, ${apiDomain}, ${accountsDomain},
        ${sealedClientId}::jsonb, ${sealedClientSecret}::jsonb, ${sealedRefresh}::jsonb,
        ${expenseAccountName}, ${expenseAccountId},
        ${paidThroughName}, ${paidThroughId},
        ${vendorId}, true
      )
      ON CONFLICT (name) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          api_domain = EXCLUDED.api_domain,
          accounts_domain = EXCLUDED.accounts_domain,
          refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
          updated_at = NOW()
    `;
    console.log(`Bootstrapped Zoho org "${name}" from ${prefix}_* env.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
