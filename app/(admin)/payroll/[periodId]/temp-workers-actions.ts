"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { payPeriods, tempWorkerEntries } from "@/lib/db/schema";
import {
  createTempWorker,
  deleteTempWorker,
} from "@/lib/db/queries/temp-workers";

const idSchema = z.string().uuid();

const createSchema = z.object({
  workerName: z.string().min(1).max(200),
  description: z
    .union([z.string().max(500), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  hours: z
    .union([
      z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/, "Use a number like 8 or 8.5")
        .transform((s) => Number(s).toFixed(2)),
      z.literal("").transform(() => null),
    ])
    .nullable()
    .optional(),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a dollar value, e.g. 200.00")
    .transform((s) => Math.round(Number(s) * 100)),
  notes: z
    .union([z.string().max(1000), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
});

export async function createTempWorkerAction(
  periodId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(periodId).success) {
    return { error: "Invalid period." };
  }
  const parsed = createSchema.safeParse({
    workerName: formData.get("workerName"),
    description: formData.get("description") ?? "",
    hours: formData.get("hours") ?? "",
    amount: formData.get("amount"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (parsed.data.amount <= 0) {
    return { error: "Amount must be greater than $0.00." };
  }
  // Block edits on PAID periods — temp workers are part of the period total
  // and cannot change after payment.
  const [period] = await db
    .select({ state: payPeriods.state })
    .from(payPeriods)
    .where(eq(payPeriods.id, periodId));
  if (!period) return { error: "Period not found." };
  if (period.state === "PAID") {
    return { error: "Period is paid — unmark paid first to edit." };
  }
  try {
    await createTempWorker(
      {
        periodId,
        workerName: parsed.data.workerName,
        description: parsed.data.description ?? null,
        hours: parsed.data.hours ?? null,
        amountCents: parsed.data.amount,
        notes: parsed.data.notes ?? null,
        createdById: session.user.id,
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Could not add temp worker.",
    };
  }
  revalidatePath(`/payroll/${periodId}`);
  revalidatePath("/reports");
}

export async function deleteTempWorkerAction(
  entryId: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(entryId).success) {
    return { error: "Invalid id." };
  }
  // Look up the period to check state + revalidate the right path.
  const [entry] = await db
    .select({ periodId: tempWorkerEntries.periodId })
    .from(tempWorkerEntries)
    .where(eq(tempWorkerEntries.id, entryId));
  if (!entry) return { error: "Entry not found." };
  const [period] = await db
    .select({ state: payPeriods.state })
    .from(payPeriods)
    .where(eq(payPeriods.id, entry.periodId));
  if (period?.state === "PAID") {
    return { error: "Period is paid — unmark paid first to edit." };
  }
  try {
    await deleteTempWorker(entryId, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not remove entry.",
    };
  }
  revalidatePath(`/payroll/${entry.periodId}`);
  revalidatePath("/reports");
}
