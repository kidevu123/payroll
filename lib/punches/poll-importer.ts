// Pair raw NGTeco punch events into in/out and persist them.
//
// Each scrape returns a flat list of individual punch events. We:
//   1. Match each personId to an Employee (employees.ngteco_employee_ref,
//      with leading-zero normalization).
//   2. Group by (employee_id, day-in-employee-tz).
//   3. Sort each group chronologically and walk it: even index = clock_in,
//      odd index = clock_out for the previous in. An odd-length tail
//      lands as an in-only punch (the employee is still on the clock).
//   4. UPSERT into punches keyed on a stable hash of (employee_id, clock_in).
//      On conflict update clock_out (catches the case where the matching
//      out punch arrived in a later poll) and notes.
//
// Imported lazily from lib/jobs/handlers/punch-poll.ts so node:crypto
// stays out of the edge-bundle analysis path.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, punches, payPeriods } from "@/lib/db/schema";
import { ensureNextPeriod, getCurrentPeriod } from "@/lib/db/queries/pay-periods";
import { writeAudit } from "@/lib/db/audit";
import type { RawPunchEvent } from "@/lib/ngteco/scraper";

export type PollImportSummary = {
  rawEvents: number;
  unmatchedRefs: number;
  pairsInserted: number;
  pairsUpdated: number;
  openShifts: number;
};

function normalizeRef(s: string): string {
  if (!s) return "";
  if (s.startsWith("TEMP_")) return s;
  const numeric = Number(s.replace(/^0+/, "") || "0");
  return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : s;
}

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}

export async function importPunchPoll(
  events: RawPunchEvent[],
  options: { timezone: string },
): Promise<PollImportSummary> {
  const summary: PollImportSummary = {
    rawEvents: events.length,
    unmatchedRefs: 0,
    pairsInserted: 0,
    pairsUpdated: 0,
    openShifts: 0,
  };
  if (events.length === 0) return summary;
  // Node built-in `crypto` is registered as a webpack server external in
  // next.config.mjs, so a regular dynamic import works from any chunk.
  const { createHash } = await import("crypto");

  // Resolve every refs → employee in one go.
  // Exclude TERMINATED employees from the poll mapping. A terminated
  // employee shouldn't keep accumulating new cron-poll punches; if the
  // NGTeco vendor still has their badge, we skip with no warning. ACTIVE
  // + INACTIVE both pass through (INACTIVE is a soft-pause state,
  // typically used mid-leave).
  const empRows = await db
    .select({
      id: employees.id,
      ref: employees.ngtecoEmployeeRef,
    })
    .from(employees)
    .where(
      and(
        sql`${employees.ngtecoEmployeeRef} IS NOT NULL`,
        sql`${employees.status} <> 'TERMINATED'`,
      ),
    );
  const empByRef = new Map<string, string>();
  for (const r of empRows) {
    if (r.ref) empByRef.set(r.ref, r.id);
  }

  // Group by employee × day.
  type Group = { empId: string; day: string; events: RawPunchEvent[] };
  const groups = new Map<string, Group>();
  for (const ev of events) {
    const ref = normalizeRef(ev.personId);
    const empId = empByRef.get(ref);
    if (!empId) {
      summary.unmatchedRefs++;
      continue;
    }
    const day = dayKey(ev.punchAt, options.timezone);
    const k = `${empId}|${day}`;
    const g = groups.get(k) ?? { empId, day, events: [] };
    g.events.push(ev);
    groups.set(k, g);
  }

  // For each group, pair and upsert.
  for (const g of groups.values()) {
    const periodId = await resolvePeriodIdForDay(g.day, options.timezone);
    if (!periodId) continue;
    const sorted = g.events
      .slice()
      .sort((a, b) => a.punchAt.localeCompare(b.punchAt));
    for (let i = 0; i < sorted.length; i += 2) {
      const inEv = sorted[i]!;
      const outEv = sorted[i + 1] ?? null;
      const clockIn = new Date(inEv.punchAt);
      const clockOut = outEv ? new Date(outEv.punchAt) : null;
      if (!outEv) summary.openShifts++;
      const hash = createHash("sha256")
        .update(`${g.empId}|${inEv.punchAt}`)
        .digest("hex")
        .slice(0, 32);
      const noteParts = [
        inEv.verifyType ? `in:${inEv.verifyType}` : null,
        outEv?.verifyType ? `out:${outEv.verifyType}` : null,
        inEv.source ? `dev:${inEv.source}` : null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      const existing = await db
        .select({ id: punches.id, clockOut: punches.clockOut })
        .from(punches)
        .where(eq(punches.ngtecoRecordHash, hash));
      if (existing.length > 0) {
        const row = existing[0]!;
        if (
          (row.clockOut === null && clockOut !== null) ||
          (row.clockOut !== null &&
            clockOut !== null &&
            row.clockOut.getTime() !== clockOut.getTime())
        ) {
          await db
            .update(punches)
            .set({ clockOut, notes: note })
            .where(eq(punches.id, row.id));
          summary.pairsUpdated++;
        }
      } else {
        // ON CONFLICT DO NOTHING — concurrent poll runs (or a poll racing
        // a manual upload) can otherwise throw 23505 mid-batch and abort
        // the rest of the loop. The unique index on ngteco_record_hash
        // is the de-dupe contract; silently skipping a duplicate is fine.
        const inserted = await db
          .insert(punches)
          .values({
            employeeId: g.empId,
            periodId,
            clockIn,
            clockOut,
            source: "NGTECO_AUTO",
            ngtecoRecordHash: hash,
            notes: note,
          })
          .onConflictDoNothing({ target: punches.ngtecoRecordHash })
          .returning({ id: punches.id });
        if (inserted.length > 0) summary.pairsInserted++;
      }
    }
  }

  if (summary.pairsInserted + summary.pairsUpdated + summary.unmatchedRefs > 0) {
    await writeAudit({
      actorId: null,
      actorRole: null,
      action: "ngteco.poll.import",
      targetType: "System",
      targetId: `ngteco-poll-${Date.now()}`,
      after: summary,
    });
  }
  void and;
  return summary;
}

async function resolvePeriodIdForDay(
  dayIso: string,
  timezone: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: payPeriods.id })
    .from(payPeriods)
    .where(
      and(
        sql`${payPeriods.startDate} <= ${dayIso}::date`,
        sql`${payPeriods.endDate} >= ${dayIso}::date`,
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  // Use COMPANY tz for "today" so a near-midnight first-punch can't
  // trigger a rollover create on the wrong calendar day. Without the
  // explicit timeZone, the host (Docker LXC) tz is used — UTC inside
  // the container.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  }).format(new Date());
  await ensureNextPeriod(today);
  const cur = await getCurrentPeriod(dayIso);
  return cur?.id ?? null;
}
