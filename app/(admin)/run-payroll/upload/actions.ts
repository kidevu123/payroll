"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { payPeriods, payrollRuns } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import {
  runManualCsvImport,
  type ManualImportSummary,
} from "@/lib/punches/manual-import";
import { getSetting } from "@/lib/settings/runtime";

const schema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  payScheduleId: z
    .union([z.string().uuid(), z.literal("").transform(() => null)])
    .nullable(),
  confirmDuplicate: z.string().optional(),
});

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
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (parsed.data.endDate < parsed.data.startDate) {
    return { error: "End date must be on or after start date." };
  }

  const csv = await file.text();
  const company = await getSetting("company");

  // UPSERT period by start_date.
  const [existingPeriod] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.startDate, parsed.data.startDate));
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

  // Create the MANUAL_CSV run.
  const [run] = await db
    .insert(payrollRuns)
    .values({
      periodId,
      state: "INGESTING",
      scheduledFor: new Date(),
      ingestStartedAt: new Date(),
      source: "MANUAL_CSV",
      payScheduleId: parsed.data.payScheduleId,
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

  revalidatePath("/payroll");
  revalidatePath("/reports");
  return { ok: true, runId: run.id, summary };
}
