"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { employees, payPeriods, payrollRuns, tempWorkerEntries } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import {
  runManualCsvImport,
  type ManualImportSummary,
} from "@/lib/punches/manual-import";
import { parse as parseCsv } from "@/lib/punches/parser";
import { getSetting } from "@/lib/settings/runtime";

const schema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  payScheduleId: z
    .union([z.string().uuid(), z.literal("").transform(() => null)])
    .nullable(),
  confirmDuplicate: z.string().optional(),
  /**
   * JSON-stringified array of employee ids the admin selected. Empty
   * (or missing) means "include everyone in the CSV" — the legacy
   * single-step upload behavior. Set means "lock the cohort to these".
   */
  cohortJson: z.string().optional(),
  /**
   * JSON-stringified array of temp worker entries to attach to the
   * resulting period. Each row inserts a temp_worker_entries row.
   */
  tempWorkersJson: z.string().optional(),
});

const tempWorkerSchema = z
  .object({
    workerName: z.string().min(1).max(200),
    amountCents: z.number().int().min(1),
    hours: z.union([z.number().min(0), z.null()]).optional(),
    description: z.union([z.string().max(500), z.null()]).optional(),
  })
  .strict();

export type OverlappingRun = {
  runId: string;
  source: string;
  state: string;
  startDate: string;
  endDate: string;
  totalAmountCents: number | null;
};

/**
 * Look for any payroll_run whose period overlaps [start, end]. Used to
 * warn the admin BEFORE the upload commits — most "I uploaded twice by
 * accident" cases are caught here.
 */
export async function findOverlappingRunsAction(
  startDate: string,
  endDate: string,
): Promise<OverlappingRun[]> {
  await requireAdmin();
  if (!z.string().date().safeParse(startDate).success) return [];
  if (!z.string().date().safeParse(endDate).success) return [];
  const rows = await db
    .select({
      runId: payrollRuns.id,
      source: payrollRuns.source,
      state: payrollRuns.state,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      totalAmountCents: payrollRuns.totalAmountCents,
    })
    .from(payrollRuns)
    .innerJoin(payPeriods, eq(payrollRuns.periodId, payPeriods.id))
    .where(
      and(
        lte(payPeriods.startDate, endDate),
        gte(payPeriods.endDate, startDate),
        // Hide zombies — CANCELLED and INGEST_FAILED runs aren't real
        // overlaps the admin needs to confirm against. They clutter the
        // warning panel and confuse the "did this already publish?" question.
        sql`${payrollRuns.state} NOT IN ('CANCELLED','INGEST_FAILED','FAILED')`,
      ),
    )
    .orderBy(sql`${payPeriods.startDate} DESC`);
  return rows.map((r) => ({
    runId: r.runId,
    source: r.source,
    state: r.state,
    startDate: r.startDate,
    endDate: r.endDate,
    totalAmountCents: r.totalAmountCents,
  }));
}

export type UploadCsvResult =
  | { error: string }
  | { ok: true; runId: string; summary: ManualImportSummary };

export type CsvPreviewEmployee = {
  /** Employee uuid in the local DB (null when CSV row didn't match anyone). */
  employeeId: string | null;
  /** Display name from DB if matched, else CSV name. */
  displayName: string;
  /** NGTeco / legacy ref from the CSV. */
  ngtecoRef: string;
  /** Days the employee has rows for in the CSV (within range). */
  dayCount: number;
  /** Hours summed from the CSV's punch_in / punch_out for matched days. */
  totalHours: number;
  /** Pay schedule the employee is on. Helps the admin decide quickly. */
  payScheduleName: string | null;
  /** Pay type — SALARIED rows are paid externally, no payslip computed. */
  payType: "HOURLY" | "FLAT_TASK" | "SALARIED" | null;
  /** True when no DB employee has this NGTeco ref. UI surfaces a warning. */
  unmatched: boolean;
};

export type CsvPreviewResult =
  | { error: string }
  | {
      ok: true;
      employees: CsvPreviewEmployee[];
      parseErrors: number;
      dateRange: { min: string; max: string } | null;
    };

/**
 * Parse the CSV and return per-employee summaries WITHOUT touching the DB.
 * The admin sees this list, picks who to include, then submits the real
 * upload via uploadCsvAction with selectedEmployeeIds.
 */
export async function previewCsvAction(
  formData: FormData,
): Promise<CsvPreviewResult> {
  await requireAdmin();
  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file." };
  }
  const company = await getSetting("company");
  const csv = await file.text();
  const result = parseCsv(csv, company.timezone);
  if (result.candidates.length === 0 && result.errors.length === 0) {
    return { error: "CSV appears empty." };
  }

  // Group candidates by ngtecoRef.
  const byRef = new Map<
    string,
    { ngtecoRef: string; name: string; days: Set<string>; hoursMs: number }
  >();
  let minIso: string | null = null;
  let maxIso: string | null = null;
  for (const c of result.candidates) {
    const day = c.clockIn.slice(0, 10);
    if (minIso === null || day < minIso) minIso = day;
    if (maxIso === null || day > maxIso) maxIso = day;
    let entry = byRef.get(c.ngtecoEmployeeRef);
    if (!entry) {
      entry = {
        ngtecoRef: c.ngtecoEmployeeRef,
        name: c.ngtecoEmployeeName ?? c.ngtecoEmployeeRef,
        days: new Set(),
        hoursMs: 0,
      };
      byRef.set(c.ngtecoEmployeeRef, entry);
    }
    entry.days.add(day);
    if (c.clockOut) {
      entry.hoursMs +=
        new Date(c.clockOut).getTime() - new Date(c.clockIn).getTime();
    }
  }

  // Match against DB employees.
  const refs = [...byRef.keys()];
  const dbEmployees = refs.length
    ? await db
        .select()
        .from(employees)
        .where(inArray(employees.ngtecoEmployeeRef, refs))
    : [];
  const empByRef = new Map(
    dbEmployees.map((e) => [e.ngtecoEmployeeRef!, e]),
  );

  // Pull pay-schedule names in one shot.
  const scheduleIds = [
    ...new Set(
      dbEmployees
        .map((e) => e.payScheduleId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { paySchedules } = await import("@/lib/db/schema");
  const schedules = scheduleIds.length
    ? await db.select().from(paySchedules).where(inArray(paySchedules.id, scheduleIds))
    : [];
  const scheduleNameById = new Map(schedules.map((s) => [s.id, s.name]));

  const out: CsvPreviewEmployee[] = [];
  for (const entry of byRef.values()) {
    const emp = empByRef.get(entry.ngtecoRef) ?? null;
    out.push({
      employeeId: emp?.id ?? null,
      displayName: emp?.displayName ?? entry.name,
      ngtecoRef: entry.ngtecoRef,
      dayCount: entry.days.size,
      totalHours: Math.round((entry.hoursMs / 3_600_000) * 100) / 100,
      payScheduleName: emp?.payScheduleId
        ? scheduleNameById.get(emp.payScheduleId) ?? null
        : null,
      payType: emp?.payType ?? null,
      unmatched: !emp,
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    ok: true,
    employees: out,
    parseErrors: result.errors.length,
    dateRange: minIso && maxIso ? { min: minIso, max: maxIso } : null,
  };
}

export async function uploadCsvAction(
  formData: FormData,
): Promise<UploadCsvResult> {
  const session = await requireAdmin();
  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file." };
  }
  const parsed = schema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    payScheduleId: formData.get("payScheduleId") || null,
    confirmDuplicate: formData.get("confirmDuplicate") || undefined,
    cohortJson: formData.get("cohortJson") || undefined,
    tempWorkersJson: formData.get("tempWorkersJson") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    return { error: "End date must be on or after start date." };
  }

  // Parse the explicit admin cohort selection if present.
  let cohortIds: string[] | null = null;
  if (parsed.data.cohortJson) {
    try {
      const arr = JSON.parse(parsed.data.cohortJson);
      if (
        Array.isArray(arr) &&
        arr.every((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))
      ) {
        cohortIds = arr;
      }
    } catch {
      // ignore malformed cohort json — falls back to "all"
    }
  }

  const csv = await file.text();
  const company = await getSetting("company");

  // Schedule isolation: when a cohort is set AND a payScheduleId is
  // chosen, every cohort employee must be on that exact schedule.
  // Prevents a semi-monthly upload from accidentally sweeping weekly
  // employees (and vice versa). Owner directive: "if the csv being
  // uploaded is flagged semi monthly it shouldnt not add to the any
  // other weekly or anything they should remain two differnt
  // workflows".
  if (parsed.data.payScheduleId && cohortIds && cohortIds.length > 0) {
    const cohortEmployees = await db
      .select({ id: employees.id, name: employees.displayName, payScheduleId: employees.payScheduleId })
      .from(employees)
      .where(inArray(employees.id, cohortIds));
    const mismatched = cohortEmployees.filter(
      (e) => e.payScheduleId !== parsed.data.payScheduleId,
    );
    if (mismatched.length > 0) {
      const names = mismatched
        .slice(0, 3)
        .map((e) => e.name)
        .join(", ");
      const more = mismatched.length > 3 ? ` +${mismatched.length - 3} more` : "";
      return {
        error: `Schedule mismatch: ${mismatched.length} selected employee${
          mismatched.length === 1 ? "" : "s"
        } (${names}${more}) ${mismatched.length === 1 ? "is" : "are"} not on this pay schedule. Reassign them in /employees first, or uncheck them.`,
      };
    }
  }

  // UPSERT period by (pay_schedule_id, start_date). The pay_schedule_id
  // segregates overlapping schedules so weekly + semi-monthly periods
  // can share calendar dates without trampling each other.
  const scheduleFilter = parsed.data.payScheduleId
    ? eq(payPeriods.payScheduleId, parsed.data.payScheduleId)
    : sql`${payPeriods.payScheduleId} IS NULL`;
  const [existingPeriod] = await db
    .select()
    .from(payPeriods)
    .where(
      and(
        eq(payPeriods.startDate, parsed.data.startDate),
        scheduleFilter,
      ),
    );
  let periodId: string;
  if (existingPeriod) {
    periodId = existingPeriod.id;
    if (existingPeriod.endDate !== parsed.data.endDate) {
      await db
        .update(payPeriods)
        .set({ endDate: parsed.data.endDate })
        .where(eq(payPeriods.id, periodId));
    }
  } else {
    const [row] = await db
      .insert(payPeriods)
      .values({
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        state: "OPEN",
        payScheduleId: parsed.data.payScheduleId,
      })
      .returning();
    if (!row) return { error: "Could not create pay period." };
    periodId = row.id;
  }

  // Auto-cancel zombie failed/scheduled MANUAL_CSV runs for this same
  // period so the warning list doesn't accumulate. They came from prior
  // upload attempts that hit dedup or parse errors. Real PUBLISHED runs
  // are left alone.
  const cancelled = await db
    .update(payrollRuns)
    .set({ state: "CANCELLED" })
    .where(
      and(
        eq(payrollRuns.periodId, periodId),
        eq(payrollRuns.source, "MANUAL_CSV"),
        sql`${payrollRuns.state} IN ('INGEST_FAILED','INGESTING','SCHEDULED')`,
      ),
    )
    .returning({ id: payrollRuns.id });
  if (cancelled.length > 0) {
    await writeAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "payroll_run.manual_csv.cleanup_failed",
      targetType: "PayPeriod",
      targetId: periodId,
      after: { cancelledRunIds: cancelled.map((c) => c.id) },
    });
  }

  // Create the MANUAL_CSV run, locking the cohort if the admin selected one.
  const [run] = await db
    .insert(payrollRuns)
    .values({
      periodId,
      state: "INGESTING",
      scheduledFor: new Date(),
      ingestStartedAt: new Date(),
      source: "MANUAL_CSV",
      payScheduleId: parsed.data.payScheduleId,
      cohortEmployeeIds: cohortIds,
      createdByName: session.user.email,
      postedAt: new Date(),
    })
    .returning();
  if (!run) return { error: "Could not create payroll run." };

  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "payroll_run.manual_csv.create",
    targetType: "PayrollRun",
    targetId: run.id,
    after: { periodId, source: "MANUAL_CSV" },
  });

  let summary: ManualImportSummary;
  try {
    summary = await runManualCsvImport({
      csv,
      payrollRunId: run.id,
      timezone: company.timezone,
      actor: { id: session.user.id, role: session.user.role },
    });
  } catch (err) {
    await db
      .update(payrollRuns)
      .set({
        state: "INGEST_FAILED",
        lastError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(payrollRuns.id, run.id));
    return { error: err instanceof Error ? err.message : "Import failed." };
  }

  // Inline temp / manual labor entries for this period. Each row was
  // already validated client-side (name + amount > 0); re-validate
  // server-side against the strict zod schema before insert.
  if (parsed.data.tempWorkersJson) {
    try {
      const arr = JSON.parse(parsed.data.tempWorkersJson);
      if (Array.isArray(arr) && arr.length > 0) {
        const validated = arr
          .map((row) => tempWorkerSchema.safeParse(row))
          .filter((r): r is { success: true; data: z.infer<typeof tempWorkerSchema> } => r.success)
          .map((r) => r.data);
        for (const tw of validated) {
          await db.insert(tempWorkerEntries).values({
            periodId,
            workerName: tw.workerName,
            amountCents: tw.amountCents,
            hours: tw.hours != null ? String(tw.hours) : null,
            description: tw.description ?? null,
            createdById: session.user.id,
          });
        }
      }
    } catch {
      // Malformed payload — skip silently. The form prevents this
      // shape from being sent; this is just defensive.
    }
  }

  revalidatePath("/payroll");
  revalidatePath("/reports");
  return { ok: true, runId: run.id, summary };
}
