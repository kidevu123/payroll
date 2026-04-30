// Phase 1 demo seed. Loads:
//   • 24 employees with realistic-looking names, mixed pay types, varied
//     hire dates, all assigned to the "Day" shift.
//   • 4 historical pay periods (closed) with plausible punch patterns —
//     mostly 8h Mon–Sat days with a couple of short days, one suspiciously
//     long day, and one midnight crossing.
//   • 1 open current period with a couple of detected exceptions
//     (NO_PUNCH on a working day, MISSING_OUT on a recent day) so the
//     dashboard has visible content.
//
// Usage:
//   tsx scripts/seed-demo.ts            # additive — won't double-seed if employees already exist
//   tsx scripts/seed-demo.ts --force    # add even if some employees exist
//
// Idempotent on the no-flag path: bails if any employees are present.
//
// This script reads + writes via the same Drizzle schema. It bypasses the
// auth + audit guards intentionally — it is only ever invoked manually by the
// operator, never from a request path. Audit rows ARE written for the
// inserted employees so the audit log isn't silent.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import {
  employees,
  employeeRateHistory,
  payPeriods,
  punches,
  shifts,
  missedPunchAlerts,
  auditLog,
} from "../lib/db/schema";

const NAMES: { display: string; legal?: string; flat?: boolean; rate: number }[] = [
  { display: "Aaliyah Hernandez", rate: 2200 },
  { display: "Marcus Brown", rate: 2400 },
  { display: "Elena Rojas", legal: "Maria Elena Rojas", rate: 2050 },
  { display: "James Walker", rate: 2350 },
  { display: "Sofia Patel", rate: 2700, flat: false },
  { display: "Tyler Nguyen", rate: 1950 },
  { display: "Maya Johnson", rate: 2100 },
  { display: "David Khan", rate: 2300 },
  { display: "Camila Diaz", rate: 2150 },
  { display: "Isaiah Carter", rate: 2250 },
  { display: "Olivia Bennett", rate: 2600 },
  { display: "Daniel Schultz", rate: 2400 },
  { display: "Priya Patel", legal: "Priyanka Patel", rate: 2500 },
  { display: "Jonas Mueller", rate: 2200 },
  { display: "Aisha Rahman", rate: 2300 },
  { display: "Ethan Cooper", rate: 2050 },
  { display: "Lila Tran", rate: 2700 },
  { display: "Noah Reyes", rate: 2350 },
  { display: "Ava Singh", rate: 2200 },
  { display: "Lucas Andersen", rate: 2400 },
  // Two FLAT_TASK contractors at the bottom.
  { display: "Roberto Cruz", flat: true, rate: 0 },
  { display: "Maria Espinoza", flat: true, rate: 0 },
  // Two terminated for the inactive bucket
  { display: "Connor Reilly", rate: 2100 },
  { display: "Hannah Lewis", rate: 2050 },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function periodBoundsForOffset(today: string, offsetWeeks: number) {
  const t = parseDay(today);
  const dow = t.getUTCDay(); // 0=Sun
  const back = (dow + 6) % 7; // back to Monday
  const start = new Date(t.getTime() - back * MS_PER_DAY + offsetWeeks * 7 * MS_PER_DAY);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  return { startDate: ymd(start), endDate: ymd(end) };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  const client = postgres(url, { max: 1 });
  try {
    const db = drizzle(client);

    const [{ count }] = (await db.execute<{ count: number }>(
      sql`select count(*)::int as count from employees`,
    )) as unknown as [{ count: number }];
    if (count > 0 && !force) {
      console.log(`Already ${count} employees present; pass --force to add more.`);
      return;
    }

    const [day] = await db.select().from(shifts).where(eq(shifts.name, "Day"));
    if (!day) {
      console.error("No 'Day' shift — run scripts/seed.ts first.");
      process.exit(1);
    }

    // ── Employees ────────────────────────────────────────────────────────────
    const today = ymd(new Date());
    const insertedIds: { id: string; rateCents: number; hiredOn: string; isFlat: boolean; terminated: boolean }[] = [];
    for (let i = 0; i < NAMES.length; i++) {
      const n = NAMES[i]!;
      const slug = n.display.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
      const email = `${slug}@example.com`;
      const hiredOn = ymd(new Date(Date.now() - (90 + i * 23) * MS_PER_DAY));
      const isFlat = !!n.flat;
      const terminated = n.display === "Connor Reilly" || n.display === "Hannah Lewis";
      const [emp] = await db
        .insert(employees)
        .values({
          legacyId: `LEGACY-${100 + i}`,
          displayName: n.display,
          legalName: n.legal ?? n.display,
          email,
          hiredOn,
          payType: isFlat ? "FLAT_TASK" : "HOURLY",
          hourlyRateCents: isFlat ? null : n.rate,
          status: terminated ? "TERMINATED" : "ACTIVE",
          shiftId: day.id,
          language: i % 7 === 0 ? "es" : "en",
        })
        .returning();
      if (!emp) continue;
      if (!isFlat) {
        await db.insert(employeeRateHistory).values({
          employeeId: emp.id,
          effectiveFrom: hiredOn,
          hourlyRateCents: n.rate,
          reason: "Initial rate at hire (demo seed)",
        });
      }
      await db.insert(auditLog).values({
        actorId: null,
        actorRole: null,
        action: "employee.create",
        targetType: "Employee",
        targetId: emp.id,
        after: emp,
      });
      insertedIds.push({ id: emp.id, rateCents: isFlat ? 0 : n.rate, hiredOn, isFlat, terminated });
    }
    console.log(`Inserted ${insertedIds.length} employees`);

    // ── Periods ──────────────────────────────────────────────────────────────
    type PRow = { id: string; startDate: string; endDate: string; state: string };
    const periodRows: PRow[] = [];
    for (const offset of [-4, -3, -2, -1, 0]) {
      const bounds = periodBoundsForOffset(today, offset);
      const state = offset === 0 ? "OPEN" : "LOCKED";
      const [row] = await db
        .insert(payPeriods)
        .values({
          startDate: bounds.startDate,
          endDate: bounds.endDate,
          state: state as "OPEN" | "LOCKED",
        })
        .onConflictDoNothing({ target: payPeriods.startDate })
        .returning();
      if (row) periodRows.push({ id: row.id, startDate: row.startDate, endDate: row.endDate, state: row.state });
    }
    console.log(`Inserted ${periodRows.length} periods`);

    // ── Punches ──────────────────────────────────────────────────────────────
    let punchCount = 0;
    for (const p of periodRows) {
      const start = parseDay(p.startDate);
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const d = new Date(start.getTime() + dayOffset * MS_PER_DAY);
        const dow = d.getUTCDay();
        if (dow === 0) continue; // skip Sundays (workingDays default is Mon–Sat)
        for (let idx = 0; idx < insertedIds.length; idx++) {
          const e = insertedIds[idx]!;
          if (e.terminated || e.isFlat) continue;
          // Skip a couple of days to create coverage gaps.
          if (dayOffset === 5 && idx % 11 === 0) continue;
          // Suspiciously long shift for one employee one day per period.
          const isSuspicious = dayOffset === 1 && idx === 3;
          // Midnight crossing for one employee one day per period.
          const isMidnight = dayOffset === 4 && idx === 7;
          const inAt = new Date(d);
          inAt.setUTCHours(13, 0, 0, 0);
          const outAt = new Date(inAt);
          if (isSuspicious) outAt.setUTCHours(13 + 16, 0, 0, 0);
          else if (isMidnight) outAt.setUTCHours(13 + 14, 30, 0, 0);
          else outAt.setUTCHours(13 + 8, 0, 0, 0);
          // For the open period, leave today's last punch incomplete for one
          // employee so we get a MISSING_OUT alert.
          const incomplete =
            p.state === "OPEN" && dayOffset === 4 && idx === 1;
          await db.insert(punches).values({
            employeeId: e.id,
            periodId: p.id,
            clockIn: inAt,
            clockOut: incomplete ? null : outAt,
            source: "LEGACY_IMPORT",
          });
          punchCount++;
        }
      }
    }
    console.log(`Inserted ${punchCount} punches`);

    // ── Alerts on the open period (NO_PUNCH on a working day) ────────────────
    const openPeriod = periodRows.find((p) => p.state === "OPEN");
    if (openPeriod && insertedIds.length > 2) {
      const target = insertedIds[2]!;
      const start = parseDay(openPeriod.startDate);
      const targetDate = ymd(new Date(start.getTime() + 2 * MS_PER_DAY));
      await db.insert(missedPunchAlerts).values({
        employeeId: target.id,
        periodId: openPeriod.id,
        date: targetDate,
        issue: "NO_PUNCH",
      });
      // And a MISSING_OUT for the incomplete punch we left above.
      const target2 = insertedIds[1]!;
      const date2 = ymd(new Date(start.getTime() + 4 * MS_PER_DAY));
      await db.insert(missedPunchAlerts).values({
        employeeId: target2.id,
        periodId: openPeriod.id,
        date: date2,
        issue: "MISSING_OUT",
      });
      console.log("Inserted 2 alerts on the open period");
    }

    console.log("\nDemo seed complete.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
