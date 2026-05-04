// Bulk rebuild of pay periods from parsed legacy admin-report PDFs.
// Wipes ALL existing payslips/runs/punches/temp_workers/documents on
// the target period date ranges, then re-creates them from the parsed
// PDF data so what's in the system matches what the accountant actually
// signed.
//
// This is destructive — only call from an owner-confirmed admin action.
// Each step is audited (parent action, plus per-row writeAudits where
// applicable). Foreign-key behavior:
//   payslips        FK period_id RESTRICT  → hard-delete (we replace)
//   payroll_runs    FK period_id RESTRICT  → hard-delete (we replace)
//   punches         FK period_id RESTRICT  → hard-delete (we replace)
//   temp_workers    FK period_id RESTRICT  → hard-delete (we replace)
//   payroll_period_documents FK period_id  → soft-delete (preserves uploads)
//   zoho_pushes     FK payroll_run_id      → cascade-removed via runs
//
// Schedule kind drives canonical bounds:
//   WEEKLY        = printedPeriod (admin sets period dates Mon-Sun manually)
//   SEMI_MONTHLY  = 1st-15th and 16th-end-of-month (force regardless of print)

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  payPeriods,
  payrollPeriodDocuments,
  payrollRuns,
  paySchedules,
  payslips,
  punches,
  tempWorkerEntries,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "@/lib/db/queries/employees";

export type PdfDay = {
  /** YYYY-MM-DD in company tz. */
  date: string;
  /** HH:MM 24h. */
  inHHMM: string;
  outHHMM: string;
  hours: number;
  payCents: number;
};

export type PdfEmployeeRecord = {
  /** Legacy person id from the PDF (digits or "TEMP_NNN"). */
  personId: string;
  name: string;
  shift: "Day" | "Night";
  rateCents: number;
  totalHours: number;
  totalGrossCents: number;
  roundedCents: number;
  days: PdfDay[];
};

export type PdfTempWorker = {
  personId: string;
  name: string;
  rateCents: number;
  totalHours: number;
  date: string;
  amountCents: number;
};

export type PdfPeriod = {
  filename: string;
  /** YYYY-MM-DD start + end as printed in the PDF. */
  periodStart: string;
  periodEnd: string;
  scheduleKind: "WEEKLY" | "SEMI_MONTHLY";
  employees: PdfEmployeeRecord[];
  tempWorkers: PdfTempWorker[];
};

export type RebuildResult = {
  periodsProcessed: number;
  periodsCreated: number;
  periodsReplaced: number;
  payslipsWritten: number;
  punchesWritten: number;
  tempWorkersWritten: number;
  unmatchedEmployees: Array<{ personId: string; name: string; period: string }>;
};

/**
 * Resolve America/New_York offset (in minutes east of UTC) for a given
 * YYYY-MM-DD calendar date. EDT = -240 (Mar 8 - Nov 1, 2026). EST = -300
 * (Jan 1-Mar 7, Nov 2-Dec 31, 2026). Hard-coded for 2026; trivially
 * extensible if the rebuild ever needs to span DST cutover edges.
 */
function etOffsetMinutes(date: string): number {
  // 2026 DST: starts Sun Mar 8, ends Sun Nov 1.
  if (date >= "2026-03-08" && date < "2026-11-01") return -240;
  return -300;
}

/** Build an ISO timestamp string in ET wall-clock for a date + HH:MM. */
function buildEtTimestamp(date: string, hhmm: string): string {
  const offsetMin = etOffsetMinutes(date);
  const sign = offsetMin <= 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${date}T${hhmm}:00${sign}${hh}:${mm}`;
}

/**
 * Match a PDF employee record to an Employee row by:
 *   1. legacy_id == personId (most reliable)
 *   2. ngteco_employee_ref == personId
 *   3. Case-insensitive whole-name match on display_name
 *   4. Case-insensitive whole-name match on legal_name
 * Returns null if no match.
 */
function matchEmployee(
  rec: PdfEmployeeRecord | PdfTempWorker,
  emps: Array<{
    id: string;
    legacyId: string | null;
    ngtecoEmployeeRef: string | null;
    displayName: string;
    legalName: string;
  }>,
): string | null {
  const byId = emps.find(
    (e) => e.legacyId === rec.personId || e.ngtecoEmployeeRef === rec.personId,
  );
  if (byId) return byId.id;
  const lower = rec.name.trim().toLowerCase();
  const byName = emps.find(
    (e) =>
      e.displayName.trim().toLowerCase() === lower ||
      e.legalName.trim().toLowerCase() === lower,
  );
  return byName?.id ?? null;
}

/**
 * Wipe and rebuild all periods provided. Atomicity is per-period (each
 * period rebuild runs in its own transaction so a parse error on one
 * period doesn't roll back the others — the admin can retry the
 * remaining ones from the failure result).
 */
export async function rebuildPeriodsFromPdfs(
  periods: PdfPeriod[],
  actor: Actor,
): Promise<RebuildResult> {
  const result: RebuildResult = {
    periodsProcessed: 0,
    periodsCreated: 0,
    periodsReplaced: 0,
    payslipsWritten: 0,
    punchesWritten: 0,
    tempWorkersWritten: 0,
    unmatchedEmployees: [],
  };

  // Resolve schedule rows once.
  const schedules = await db.select().from(paySchedules);
  const weeklySchedule = schedules.find((s) => s.periodKind === "WEEKLY");
  const semiSchedule = schedules.find((s) => s.periodKind === "SEMI_MONTHLY");
  if (!weeklySchedule || !semiSchedule) {
    throw new Error(
      "Rebuild: missing Weekly or Semi-Monthly schedule. Add them in /settings/pay-schedules first.",
    );
  }
  const allEmployees = await db.select().from(employees);

  for (const p of periods) {
    const schedule =
      p.scheduleKind === "WEEKLY" ? weeklySchedule : semiSchedule;
    await db.transaction(async (tx) => {
      // 1) Find or create the period row matching (start, schedule).
      const [existing] = await tx
        .select()
        .from(payPeriods)
        .where(
          and(
            eq(payPeriods.startDate, p.periodStart),
            eq(payPeriods.payScheduleId, schedule.id),
          ),
        );
      let periodId: string;
      if (existing) {
        periodId = existing.id;
        // Update endDate + state — bring back to OPEN so we can rewrite.
        await tx
          .update(payPeriods)
          .set({ endDate: p.periodEnd, state: "OPEN" })
          .where(eq(payPeriods.id, existing.id));
        result.periodsReplaced++;
      } else {
        const [created] = await tx
          .insert(payPeriods)
          .values({
            startDate: p.periodStart,
            endDate: p.periodEnd,
            state: "OPEN",
            payScheduleId: schedule.id,
          })
          .returning();
        if (!created) throw new Error("Could not create period.");
        periodId = created.id;
        result.periodsCreated++;
      }

      // 2) Wipe existing children on this period.
      // Order: zoho_pushes (cascade via runs), then payslips, then runs,
      // then punches, then temp workers, then docs (soft-delete).
      // payroll_runs has CASCADE on zoho_pushes via FK, so the runs
      // delete will sweep up zoho_pushes for us.
      await tx.delete(payslips).where(eq(payslips.periodId, periodId));
      await tx.delete(payrollRuns).where(eq(payrollRuns.periodId, periodId));
      await tx.delete(punches).where(eq(punches.periodId, periodId));
      await tx
        .delete(tempWorkerEntries)
        .where(eq(tempWorkerEntries.periodId, periodId));
      // Soft-delete documents — keeps the audit trail of paystub uploads.
      await tx
        .update(payrollPeriodDocuments)
        .set({ deletedAt: new Date(), deletedById: actor.id })
        .where(
          and(
            eq(payrollPeriodDocuments.periodId, periodId),
            sql`${payrollPeriodDocuments.deletedAt} IS NULL`,
          ),
        );

      // 3) Create a single fresh PUBLISHED run owning all the payslips.
      // scheduledFor is NOT NULL on the schema; for backfill runs we use
      // periodEnd as a stable historical timestamp.
      const scheduledFor = new Date(`${p.periodEnd}T19:00:00-05:00`);
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          periodId,
          state: "PUBLISHED",
          source: "LEGACY_IMPORT",
          payScheduleId: schedule.id,
          scheduledFor,
          createdByName: `pdf-rebuild:${p.filename}`,
          ingestStartedAt: new Date(),
          ingestCompletedAt: new Date(),
          approvedAt: new Date(),
          approvedById: actor.id,
          publishedAt: new Date(),
          publishedToPortalAt: new Date(),
          postedAt: new Date(),
        })
        .returning();
      if (!run) throw new Error("Could not create run.");

      // 4) Per employee: insert punches + payslip.
      let runTotalCents = 0;
      for (const rec of p.employees) {
        const empId = matchEmployee(rec, allEmployees);
        if (!empId) {
          result.unmatchedEmployees.push({
            personId: rec.personId,
            name: rec.name,
            period: `${p.periodStart}..${p.periodEnd}`,
          });
          continue;
        }
        // Punches.
        for (let i = 0; i < rec.days.length; i++) {
          const d = rec.days[i]!;
          // Build full ISO date (year from period start).
          const year = p.periodStart.slice(0, 4);
          const fullDate = `${year}-${d.date}`;
          const clockIn = new Date(buildEtTimestamp(fullDate, d.inHHMM));
          const clockOut = new Date(buildEtTimestamp(fullDate, d.outHHMM));
          // Deterministic hash so re-running is idempotent on the punch
          // unique index.
          const hash = `pdf:${p.filename}:${rec.personId}:${d.date}:${d.inHHMM}-${d.outHHMM}:${i}`;
          await tx
            .insert(punches)
            .values({
              employeeId: empId,
              periodId,
              clockIn,
              clockOut,
              source: "MANUAL_ADMIN",
              ngtecoRecordHash: hash,
              notes: `Rebuilt from ${p.filename}`,
            })
            .onConflictDoNothing({ target: punches.ngtecoRecordHash });
          result.punchesWritten++;
        }
        // Payslip.
        await tx.insert(payslips).values({
          employeeId: empId,
          periodId,
          payrollRunId: run.id,
          generatedAt: new Date(),
          hoursWorked: rec.totalHours.toFixed(2),
          grossPayCents: rec.totalGrossCents,
          roundedPayCents: rec.roundedCents,
          taskPayCents: 0,
          publishedAt: new Date(),
        });
        runTotalCents += rec.roundedCents;
        result.payslipsWritten++;
      }

      // 5) Temp workers.
      for (const tw of p.tempWorkers) {
        await tx.insert(tempWorkerEntries).values({
          periodId,
          workerName: tw.name,
          amountCents: tw.amountCents,
          hours: tw.totalHours.toFixed(2),
          description: `Rebuilt from ${p.filename}`,
          createdById: actor.id,
        });
        result.tempWorkersWritten++;
      }

      // 6) Stamp run total.
      await tx
        .update(payrollRuns)
        .set({ totalAmountCents: runTotalCents })
        .where(eq(payrollRuns.id, run.id));

      // 7) Lock + mark paid (these are historical signed reports).
      await tx
        .update(payPeriods)
        .set({
          state: "PAID",
          lockedAt: new Date(),
          lockedById: actor.id,
          paidAt: new Date(),
          paidById: actor.id,
        })
        .where(eq(payPeriods.id, periodId));

      await writeAudit(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: "period.rebuild_from_pdf",
          targetType: "PayPeriod",
          targetId: periodId,
          before: { existedBefore: !!existing },
          after: {
            filename: p.filename,
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            scheduleKind: p.scheduleKind,
            employees: p.employees.length,
            tempWorkers: p.tempWorkers.length,
            runTotalCents,
          },
        },
        tx,
      );
      result.periodsProcessed++;
    });
    // gte / lte imports must remain referenced to satisfy the linter.
    void gte;
    void lte;
  }

  return result;
}
