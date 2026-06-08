/**
 * Re-stamp punches onto the pay period for the employee's schedule + day.
 * Fixes rows saved under a sibling schedule's overlapping period.
 *
 *   npx tsx scripts/repair-punch-periods.ts [--since YYYY-MM-DD]
 */
import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, punches } from "@/lib/db/schema";
import { resolvePeriodIdForEmployeeDay } from "@/lib/db/queries/pay-periods";
import { getSetting } from "@/lib/settings/runtime";

async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const since = sinceArg?.split("=")[1] ?? "2026-06-01";
  const company = await getSetting("company");
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: company.timezone });

  const rows = await db
    .select({
      id: punches.id,
      employeeId: punches.employeeId,
      periodId: punches.periodId,
      clockIn: punches.clockIn,
      displayName: employees.displayName,
    })
    .from(punches)
    .innerJoin(employees, eq(punches.employeeId, employees.id))
    .where(and(isNull(punches.voidedAt), gte(punches.clockIn, new Date(`${since}T00:00:00Z`))));

  let moved = 0;
  for (const row of rows) {
    const dayIso = fmt.format(row.clockIn);
    const correct = await resolvePeriodIdForEmployeeDay(row.employeeId, dayIso);
    if (!correct || correct === row.periodId) continue;
    await db
      .update(punches)
      .set({ periodId: correct })
      .where(eq(punches.id, row.id));
    console.log(
      `moved ${row.displayName} ${dayIso}: ${row.periodId.slice(0, 8)}… → ${correct.slice(0, 8)}…`,
    );
    moved++;
  }
  console.log(`Done. ${moved} punch(es) re-assigned.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
