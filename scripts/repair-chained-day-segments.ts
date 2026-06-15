/**
 * Fleet repair: collapse chained NGTeco micro-segments into one shift per day.
 *
 *   npx tsx scripts/repair-chained-day-segments.ts [--since=YYYY-MM-DD] [--dry-run]
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, punches } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/runtime";
import { mergeChainedDaySegments } from "@/lib/punches/merge-chained-day-segments";

async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const since = sinceArg?.split("=")[1] ?? "2026-06-01";
  const dryRun = process.argv.includes("--dry-run");
  const company = await getSetting("company");
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  });

  const rows = await db
    .select({
      employeeId: punches.employeeId,
      clockIn: punches.clockIn,
      displayName: employees.displayName,
    })
    .from(punches)
    .innerJoin(employees, eq(punches.employeeId, employees.id))
    .where(
      and(
        isNull(punches.voidedAt),
        sql`${punches.clockOut} IS NOT NULL`,
        sql`${punches.clockIn}::date >= ${since}::date`,
      ),
    );

  const keys = new Map<string, string>();
  for (const row of rows) {
    const day = dayFmt.format(row.clockIn);
    const key = `${row.employeeId}|${day}`;
    keys.set(key, row.displayName);
  }

  let voided = 0;
  for (const [key, name] of keys) {
    const [employeeId, day] = key.split("|");
    if (dryRun) {
      console.log(`[dry-run] would merge chained segments for ${name} ${day}`);
      continue;
    }
    const n = await mergeChainedDaySegments(
      employeeId!,
      day!,
      company.timezone,
    );
    if (n > 0) {
      console.log(`merged ${name} ${day}: voided ${n} chained segment(s)`);
      voided += n;
    }
  }

  console.log(
    `Done. ${voided} chained segment(s) ${dryRun ? "would be " : ""}voided.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
