// Seed the bare minimum so a fresh database can boot and accept setup.
//
// • Creates a single "Day" Shift (per §21 #5 — single shift, no nightshift).
// • Sets safe Setting defaults so getSetting() returns the same values
//   whether or not the row has been written yet.
//
// Idempotent. Safe to run after every deploy.
//
// Owner OWNER user is NOT seeded here — it's created interactively at /setup
// (or via OWNER_EMAIL/OWNER_PASSWORD env if the operator prefers).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { shifts, settings } from "../lib/db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);

    // ── One shift, named "Day" ──
    const [existing] = await db.select().from(shifts).where(eq(shifts.name, "Day")).limit(1);
    if (!existing) {
      await db.insert(shifts).values({
        name: "Day",
        colorHex: "#0f766e",
        sortOrder: 0,
      });
      console.log("Seeded shift: Day");
    }

    // ── Default Settings rows so /admin/settings shows real values ──
    const seedDefaults: Array<{ key: string; value: unknown }> = [
      {
        key: "payPeriod",
        value: {
          lengthDays: 7,
          startDayOfWeek: 1,
          workingDays: [1, 2, 3, 4, 5, 6],
          firstStartDate: null,
        },
      },
      {
        key: "payRules",
        value: {
          rounding: "NEAREST_DOLLAR",
          hoursDecimalPlaces: 2,
          overtime: { enabled: false, thresholdHours: 40, multiplier: 1.5 },
        },
      },
      {
        key: "automation",
        value: {
          payrollRun: { enabled: true, cron: "0 19 * * 0" },
          employeeFixWindowHours: 24,
          adminAutoNotifyOnIngestFail: true,
          suspiciousDurationMinutesShortThreshold: 240,
          suspiciousDurationMinutesLongThreshold: 840,
        },
      },
      {
        key: "security",
        value: {
          adminTwoFactorRequired: false,
          sessionTimeoutDays: 30,
          loginRateLimit: { maxAttempts: 5, windowMinutes: 15 },
        },
      },
    ];

    for (const row of seedDefaults) {
      await db
        .insert(settings)
        .values(row)
        .onConflictDoNothing({ target: settings.key });
    }
    console.log(`Seeded ${seedDefaults.length} default settings (skip-on-conflict).`);

    // ── Smoke check ──
    const [{ count }] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from settings`,
    );
    console.log(`Settings row count: ${count}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
