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
import { pairPunchEvents, DUPLICATE_PUNCH_WINDOW_MS } from "./pair-events";
import { voidSupersededAmbiguousPunches } from "./superseded-ambiguous";

export type PollImportSummary = {
  rawEvents: number;
  unmatchedRefs: number;
  pairsInserted: number;
  pairsUpdated: number;
  openShifts: number;
  /** Out-only NGTeco rows (missing clock-in sentinel). */
  missingClockIn: number;
  /** Single punch where in vs out is unknown. */
  unpairedPunches: number;
  /** Calendar days (company tz) that had punch events in this import. */
  daysTouched: string[];
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
    missingClockIn: 0,
    unpairedPunches: 0,
    daysTouched: [],
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
      payScheduleId: employees.payScheduleId,
    })
    .from(employees)
    .where(
      and(
        sql`${employees.ngtecoEmployeeRef} IS NOT NULL`,
        sql`${employees.status} <> 'TERMINATED'`,
      ),
    );
  const empByRef = new Map<string, string>();
  const scheduleByEmp = new Map<string, string | null>();
  for (const r of empRows) {
    if (r.ref) {
      empByRef.set(r.ref, r.id);
      scheduleByEmp.set(r.id, r.payScheduleId);
    }
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
  summary.daysTouched = [...new Set([...groups.values()].map((g) => g.day))].sort();

  // For each group, pair and upsert.
  // through so a fresh auto-created period gets tagged with the right
  // schedule (Owner: "the period is clearly a weekly period" — fix is
  // to pass the schedule from the matched employee, not rely on a
  // legacy single-cadence default).
  for (const g of groups.values()) {
    const periodId = await resolvePeriodIdForDay(
      g.day,
      options.timezone,
      scheduleByEmp.get(g.empId) ?? null,
    );
    if (!periodId) continue;
    const pairedEvents = pairPunchEvents(g.events, options.timezone);
    for (const paired of pairedEvents) {
      const inEv =
        paired.kind === "ambiguous"
          ? paired.ev
          : paired.kind === "outOnly"
            ? paired.outEv
            : paired.inEv;
      const outEv =
        paired.kind === "complete" ? paired.outEv : null;
      const clockIn = new Date(inEv.punchAt);
      const clockOut =
        paired.kind === "outOnly"
          ? new Date(paired.outEv.punchAt)
          : outEv
            ? new Date(outEv.punchAt)
            : null;
      if (paired.kind === "open") summary.openShifts++;
      if (paired.kind === "outOnly") summary.missingClockIn++;
      if (paired.kind === "ambiguous") summary.unpairedPunches++;
      const hashKey =
        paired.kind === "outOnly"
          ? `${g.empId}|outOnly|${inEv.punchAt}`
          : paired.kind === "ambiguous"
            ? `${g.empId}|ambiguous|${inEv.punchAt}`
            : `${g.empId}|${inEv.punchAt}`;
      const hash = createHash("sha256")
        .update(hashKey)
        .digest("hex")
        .slice(0, 32);
      const noteParts = [
        paired.kind === "ambiguous" ? "ambiguous:single" : null,
        paired.kind === "outOnly"
          ? null
          : inEv.verifyType
            ? `in:${inEv.verifyType}`
            : null,
        outEv?.verifyType ? `out:${outEv.verifyType}` : null,
        inEv.source ? `dev:${inEv.source}` : null,
        paired.kind === "outOnly" ? "missing:in" : null,
      ].filter(Boolean);
      const note = noteParts.length ? noteParts.join(" · ") : null;

      let existing = await db
        .select({
          id: punches.id,
          clockOut: punches.clockOut,
          voidedAt: punches.voidedAt,
        })
        .from(punches)
        .where(eq(punches.ngtecoRecordHash, hash));
      const activeByHash = existing.filter((row) => row.voidedAt === null);
      if (activeByHash.length > 0) {
        existing = activeByHash;
      }

      // Fallback match — backfill recovery scenario. The original
      // IN-only poll stored the punch with a hash from THAT scrape's
      // punchAt; today's backfill might compose punchAt slightly
      // differently (NGTeco refining the second-precision after the
      // device fully synced, the row's tz cell rendering differently,
      // etc.). When that happens the hash mismatches and we'd insert
      // a brand-new row, leaving the original IN-only punch open
      // forever — exactly the "yesterday's closing hours never
      // filled" failure mode operators hit.
      //
      // So if no exact-hash match: look for an OPEN punch on the same
      // (employee, day) whose clockIn sits within ±5 minutes of our
      // new IN event. If found, treat them as the same shift and
      // update its clockOut. We also re-stamp the hash so the next
      // poll converges on the canonical key.
      if (
        existing.length === 0 &&
        paired.kind !== "outOnly" &&
        paired.kind !== "ambiguous"
      ) {
        const dayStart = new Date(`${g.day}T00:00:00Z`);
        const dayEnd = new Date(dayStart.getTime() + 86_400_000);
        const candidates = await db
          .select({
            id: punches.id,
            clockIn: punches.clockIn,
            clockOut: punches.clockOut,
          })
          .from(punches)
          .where(
            and(
              eq(punches.employeeId, g.empId),
              sql`${punches.clockIn} >= ${dayStart.toISOString()}::timestamptz`,
              sql`${punches.clockIn} < ${dayEnd.toISOString()}::timestamptz`,
              sql`${punches.clockOut} IS NULL`,
              sql`${punches.voidedAt} IS NULL`,
            ),
          );
        const targetMs = clockIn.getTime();
        const matched = candidates.find(
          (c) =>
            Math.abs(c.clockIn.getTime() - targetMs) <= DUPLICATE_PUNCH_WINDOW_MS,
        );
        if (matched) {
          existing = [
            { id: matched.id, clockOut: matched.clockOut, voidedAt: null },
          ];
          await db
            .update(punches)
            .set({ ngtecoRecordHash: hash })
            .where(eq(punches.id, matched.id));
        }
      }

      // Convert legacy afternoon "out-only" guesses into ambiguous singles.
      if (existing.length === 0 && paired.kind === "ambiguous") {
        const dayStart = new Date(`${g.day}T00:00:00Z`);
        const dayEnd = new Date(dayStart.getTime() + 86_400_000);
        const dayRows = await db
          .select({
            id: punches.id,
            clockIn: punches.clockIn,
            clockOut: punches.clockOut,
          })
          .from(punches)
          .where(
            and(
              eq(punches.employeeId, g.empId),
              sql`${punches.clockIn} >= ${dayStart.toISOString()}::timestamptz`,
              sql`${punches.clockIn} < ${dayEnd.toISOString()}::timestamptz`,
              sql`${punches.voidedAt} IS NULL`,
            ),
          );
        const targetMs = clockIn.getTime();
        const legacy = dayRows.find((row) => {
          const outMs = row.clockOut?.getTime() ?? null;
          if (outMs === null) {
            return (
              Math.abs(row.clockIn.getTime() - targetMs) <=
              DUPLICATE_PUNCH_WINDOW_MS
            );
          }
          return (
            outMs === row.clockIn.getTime() &&
            Math.abs(row.clockIn.getTime() - targetMs) <=
              DUPLICATE_PUNCH_WINDOW_MS
          );
        });
        if (legacy) {
          existing = [
            {
              id: legacy.id,
              clockOut: legacy.clockOut,
              voidedAt: null,
            },
          ];
          await db
            .update(punches)
            .set({ ngtecoRecordHash: hash })
            .where(eq(punches.id, legacy.id));
        }
      }

      // Repair mis-paired micro-shifts (duplicate punch-ins treated as in/out)
      // and attach orphan clock-outs to the real open shift on the same day.
      if (existing.length === 0) {
        const dayStart = new Date(`${g.day}T00:00:00Z`);
        const dayEnd = new Date(dayStart.getTime() + 86_400_000);
        const dayRows = await db
          .select({
            id: punches.id,
            clockIn: punches.clockIn,
            clockOut: punches.clockOut,
          })
          .from(punches)
          .where(
            and(
              eq(punches.employeeId, g.empId),
              sql`${punches.clockIn} >= ${dayStart.toISOString()}::timestamptz`,
              sql`${punches.clockIn} < ${dayEnd.toISOString()}::timestamptz`,
              sql`${punches.voidedAt} IS NULL`,
            ),
          );
        const targetInMs =
          paired.kind === "outOnly"
            ? null
            : clockIn.getTime();
        const targetOutMs =
          paired.kind === "outOnly"
            ? new Date(paired.outEv.punchAt).getTime()
            : clockOut?.getTime() ?? null;

        const repairTarget = dayRows.find((row) => {
          if (targetOutMs === null) return false;
          const outMs = row.clockOut?.getTime() ?? null;
          if (outMs === null) {
            return (
              paired.kind === "outOnly" ||
              (targetInMs !== null &&
                Math.abs(row.clockIn.getTime() - targetInMs) <=
                  DUPLICATE_PUNCH_WINDOW_MS)
            );
          }
          const durationMs = outMs - row.clockIn.getTime();
          if (durationMs > DUPLICATE_PUNCH_WINDOW_MS) return false;
          if (targetInMs === null) return false;
          return (
            Math.abs(row.clockIn.getTime() - targetInMs) <=
              DUPLICATE_PUNCH_WINDOW_MS ||
            outMs <= targetOutMs + DUPLICATE_PUNCH_WINDOW_MS
          );
        });

        if (repairTarget) {
          existing = [
            {
              id: repairTarget.id,
              clockOut: repairTarget.clockOut,
              voidedAt: null,
            },
          ];
          await db
            .update(punches)
            .set({ ngtecoRecordHash: hash })
            .where(eq(punches.id, repairTarget.id));
        }
      }

      if (existing.length > 0) {
        const row = existing[0]!;
        const recyclingVoided = row.voidedAt !== null;
        const resolvedClockOut =
          paired.kind === "ambiguous" ? null : clockOut;
        const clockOutChanged =
          (row.clockOut === null && resolvedClockOut !== null) ||
          (row.clockOut !== null && resolvedClockOut === null) ||
          (row.clockOut !== null &&
            resolvedClockOut !== null &&
            row.clockOut.getTime() !== resolvedClockOut.getTime());
        if (recyclingVoided || clockOutChanged) {
          await db
            .update(punches)
            .set({
              ...(paired.kind !== "outOnly" ? { clockIn } : {}),
              clockOut: resolvedClockOut,
              notes: note,
              ...(recyclingVoided ? { voidedAt: null } : {}),
            })
            .where(eq(punches.id, row.id));
          summary.pairsUpdated++;
        }
      } else {
        // The unique index on ngteco_record_hash is PARTIAL (only when
        // hash IS NOT NULL). Postgres rejects `ON CONFLICT (col)` against
        // a partial index unless the matching WHERE clause is supplied;
        // drizzle's onConflictDoNothing emits the bare form, so we get
        //   "no unique or exclusion constraint matching the ON CONFLICT
        //    specification" (SQLSTATE 42P10).
        // We've already done the explicit `existing.length > 0` check
        // above, so the only race-window left is two pollers inserting
        // the same hash simultaneously. Catch 23505 and treat as skip.
        try {
          await db.insert(punches).values({
            employeeId: g.empId,
            periodId,
            clockIn,
            clockOut,
            source: "NGTECO_AUTO",
            ngtecoRecordHash: hash,
            notes: note,
          });
          summary.pairsInserted++;
        } catch (err) {
          const code =
            err && typeof err === "object" && "code" in err
              ? (err as { code?: string }).code
              : null;
          if (code === "23505") {
            // Concurrent insert won the race — fine, the hash is unique.
            continue;
          }
          throw err;
        }
      }
    }

    await voidSupersededAmbiguousPunches(g.empId, g.day);
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
  return summary;
}

async function resolvePeriodIdForDay(
  dayIso: string,
  timezone: string,
  payScheduleId: string | null,
): Promise<string | null> {
  // Schedule-aware lookup: prefer a period tagged with the employee's
  // schedule that contains the day. This keeps weekly + semi-monthly
  // employees on their own period rows even when both happen to span
  // the same calendar day.
  if (payScheduleId) {
    const [existingForSchedule] = await db
      .select({ id: payPeriods.id })
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.payScheduleId, payScheduleId),
          sql`${payPeriods.startDate} <= ${dayIso}::date`,
          sql`${payPeriods.endDate} >= ${dayIso}::date`,
        ),
      )
      .limit(1);
    if (existingForSchedule) return existingForSchedule.id;
    // Lazy-load the schedule-aware ensure helper; mirrors the lazy
    // crypto import above (keeps the importer's eager bundle small).
    const { ensurePeriodForSchedule } = await import(
      "@/lib/db/queries/pay-periods"
    );
    const created = await ensurePeriodForSchedule(payScheduleId, dayIso);
    return created.id;
  }

  // Legacy fallback: employee has no schedule attached. Match any
  // existing period covering the day, otherwise create one with the
  // legacy single-cadence settings (untagged).
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
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  }).format(new Date());
  await ensureNextPeriod(today);
  const cur = await getCurrentPeriod(dayIso);
  return cur?.id ?? null;
}
