/**
 * Void "From request …" punches that duplicate punch data already on file
 * for the same employee + calendar day (NGTeco poll + missed-punch approval).
 *
 *   npx tsx scripts/repair-overlap-request-punches.ts [--since=YYYY-MM-DD] [--dry-run]
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, punches } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/runtime";
import { voidPunch } from "@/lib/db/queries/punches";
import { getSystemOwnerActor } from "@/lib/db/queries/system-actor";


async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const since = sinceArg?.split("=")[1] ?? "2026-06-01";
  const dryRun = process.argv.includes("--dry-run");
  const actor = dryRun ? null : await getSystemOwnerActor();

  const company = await getSetting("company");
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  });

  const rows = await db
    .select({
      id: punches.id,
      employeeId: punches.employeeId,
      periodId: punches.periodId,
      clockIn: punches.clockIn,
      clockOut: punches.clockOut,
      notes: punches.notes,
      displayName: employees.displayName,
    })
    .from(punches)
    .innerJoin(employees, eq(punches.employeeId, employees.id))
    .where(
      and(
        isNull(punches.voidedAt),
        sql`${punches.notes} LIKE 'From request %'`,
        sql`${punches.clockIn}::date >= ${since}::date`,
      ),
    );

  let voided = 0;
  for (const row of rows) {
    const day = dayFmt.format(row.clockIn);
    const others = await db
      .select({ id: punches.id })
      .from(punches)
      .where(
        and(
          eq(punches.employeeId, row.employeeId),
          isNull(punches.voidedAt),
          sql`${punches.id} <> ${row.id}`,
          sql`(${punches.clockIn} AT TIME ZONE ${company.timezone})::date = ${day}::date`,
        ),
      );
    if (others.length === 0) continue;

    console.log(
      `${dryRun ? "[dry-run] " : ""}void ${row.displayName} ${day} request punch ${row.id.slice(0, 8)}… (${others.length} other punch(es) on file)`,
    );
    if (!dryRun && actor) {
      await voidPunch(
        row.id,
        `repair: duplicate missed-punch approval overlapped existing punches on ${day}`,
        actor,
      );
    }
    voided++;
  }

  console.log(`Done. ${voided} overlapping request punch(es) ${dryRun ? "would be " : ""}voided.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
