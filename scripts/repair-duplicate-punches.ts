/**
 * Fleet-wide repair: void duplicate punch rows (same shift landed twice).
 *
 *   npx tsx scripts/repair-duplicate-punches.ts [--since=YYYY-MM-DD] [--dry-run]
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, punches } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/runtime";
import { voidPunch } from "@/lib/db/queries/punches";
import { getSystemOwnerActor } from "@/lib/db/queries/system-actor";
import {
  minuteClusterKey,
  rankShiftsBySurvivor,
  shiftsAreNearDuplicates,
} from "@/lib/punches/near-duplicate-shift";


async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const since = sinceArg?.split("=")[1] ?? "2026-06-01";
  const dryRun = process.argv.includes("--dry-run");
  const company = await getSetting("company");
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  });
  const actor = dryRun ? null : await getSystemOwnerActor();

  const rows = await db
    .select({
      id: punches.id,
      employeeId: punches.employeeId,
      clockIn: punches.clockIn,
      clockOut: punches.clockOut,
      displayName: employees.displayName,
    })
    .from(punches)
    .innerJoin(employees, eq(punches.employeeId, employees.id))
    .where(
      and(
        isNull(punches.voidedAt),
        sql`${punches.clockIn}::date >= ${since}::date`,
        sql`${punches.clockOut} IS NOT NULL`,
      ),
    );

  const byEmpDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const day = dayFmt.format(row.clockIn);
    const key = `${row.employeeId}|${day}`;
    const list = byEmpDay.get(key) ?? [];
    list.push(row);
    byEmpDay.set(key, list);
  }

  let voided = 0;
  for (const [, dayRows] of byEmpDay) {
    if (dayRows.length < 2) continue;

    const byMinute = new Map<string, typeof dayRows>();
    for (const r of dayRows) {
      const k = minuteClusterKey({
        employeeId: r.employeeId,
        clockIn: r.clockIn,
        clockOut: r.clockOut,
      });
      const list = byMinute.get(k) ?? [];
      list.push(r);
      byMinute.set(k, list);
    }

    const clusters: (typeof dayRows)[] = [];
    for (const list of byMinute.values()) {
      if (list.length > 1) clusters.push(list);
    }
    for (const lone of dayRows) {
      if (!lone.clockOut) continue;
      const already = clusters.some((c) => c.some((x) => x.id === lone.id));
      if (already) continue;
      const near = dayRows.filter(
        (other) =>
          other.id !== lone.id &&
          other.clockOut &&
          shiftsAreNearDuplicates(lone, other),
      );
      if (near.length > 0) clusters.push([lone, ...near]);
    }

    const voidedIds = new Set<string>();
    for (const cluster of clusters) {
      const active = cluster.filter((r) => !voidedIds.has(r.id));
      if (active.length <= 1) continue;
      const ranked = rankShiftsBySurvivor(
        active.map((r) => ({
          id: r.id,
          clockIn: r.clockIn,
          clockOut: r.clockOut,
        })),
      );
      const survivor = ranked[0]!;
      const day = dayFmt.format(active[0]!.clockIn);
      for (const row of ranked.slice(1)) {
        console.log(
          `${dryRun ? "[dry-run] " : ""}void ${active[0]!.displayName} ${day} ${row.id.slice(0, 8)}… (kept ${survivor.id.slice(0, 8)}…)`,
        );
        if (!dryRun && actor) {
          await voidPunch(
            row.id,
            `repair: duplicate shift on ${day} (kept ${survivor.id})`,
            actor,
          );
        }
        voidedIds.add(row.id);
        voided++;
      }
    }
  }

  console.log(
    `Done. ${voided} duplicate punch(es) ${dryRun ? "would be " : ""}voided.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
