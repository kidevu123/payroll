/**
 * One-shot repair: merge same-day ambiguous:single pairs into complete shifts.
 * Usage: npx tsx scripts/repair-orphan-day-pairs.ts [--since=2026-06-01]
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { punches, employees } from "@/lib/db/schema";
import { reconcileOrphanDayPairs } from "@/lib/punches/reconcile-orphan-day-pairs";

const since =
  process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ??
  "2026-06-01";

async function main() {
  const rows = await db.execute(sql`
    SELECT DISTINCT p.employee_id, to_char(p.clock_in AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day
    FROM punches p
    WHERE p.voided_at IS NULL
      AND p.notes LIKE '%ambiguous:single%'
      AND p.clock_out IS NULL
      AND p.clock_in::date >= ${since}::date
    ORDER BY day, employee_id
  `);

  let merged = 0;
  for (const row of rows) {
    const empId = String((row as { employee_id: string }).employee_id);
    const day = String((row as { day: string }).day);
    merged += await reconcileOrphanDayPairs(empId, day);
  }

  const [remaining] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(punches)
    .where(
      sql`${punches.voidedAt} IS NULL AND ${punches.notes} LIKE '%ambiguous:single%' AND ${punches.clockOut} IS NULL AND ${punches.clockIn}::date >= ${since}::date`,
    );

  console.log(
    JSON.stringify({
      since,
      daysProcessed: rows.length,
      rowsVoided: merged,
      remainingOrphans: remaining?.count ?? 0,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
