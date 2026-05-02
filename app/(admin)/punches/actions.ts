"use server";

import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-guards";
import { createPunch } from "@/lib/db/queries/punches";

const schema = z.object({
  employeeId: z.string().uuid(),
  /** Calendar day in YYYY-MM-DD that the clock_in falls on. */
  date: z.string().date(),
  /** datetime-local value, e.g. 2026-04-30T06:30. Interpreted in company tz. */
  clockIn: z.string().min(1),
  clockOut: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  notes: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => v || null),
});

/**
 * Add a manual punch from anywhere — resolves the pay period from the
 * date automatically. Used by the global /punches/new entry point so
 * the admin doesn't have to navigate by period+date+employee first.
 *
 * If multiple pay_periods cover the date (overlapping schedules), pick
 * the most recently created one — which lines up with what the period
 * detail / publish handler will load.
 */
export async function addManualPunchAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = schema.safeParse({
    employeeId: formData.get("employeeId"),
    date: formData.get("date"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const clockInD = new Date(parsed.data.clockIn);
  const clockOutD = parsed.data.clockOut ? new Date(parsed.data.clockOut) : null;
  if (Number.isNaN(clockInD.getTime())) return { error: "Invalid clock-in time." };
  if (clockOutD && Number.isNaN(clockOutD.getTime())) {
    return { error: "Invalid clock-out time." };
  }
  if (clockOutD && clockOutD <= clockInD) {
    return { error: "Clock-out must be after clock-in." };
  }

  const candidates = await db
    .select()
    .from(payPeriods)
    .where(
      and(
        lte(payPeriods.startDate, parsed.data.date),
        gte(payPeriods.endDate, parsed.data.date),
      ),
    )
    .orderBy(desc(payPeriods.startDate));

  // Filter to non-PAID periods first — admin shouldn't be retroactively
  // editing already-paid weeks via the manual entry. If everything that
  // covers the date is PAID, return a clear error so the admin unmarks
  // the period explicitly.
  const editable = candidates.filter((p) => p.state !== "PAID");
  if (editable.length === 0) {
    if (candidates.length === 0) {
      return {
        error: `No pay period covers ${parsed.data.date}. Create one in Settings → Pay periods first.`,
      };
    }
    return {
      error: `Every pay period covering ${parsed.data.date} is marked PAID. Unmark paid first to add punches.`,
    };
  }

  // If multiple periods are eligible (e.g. weekly + semi-monthly overlap),
  // prefer the OPEN one; if none are OPEN, take the most recent LOCKED.
  const open = editable.find((p) => p.state === "OPEN");
  const period = open ?? editable[0]!;

  await createPunch(
    {
      employeeId: parsed.data.employeeId,
      periodId: period.id,
      clockIn: clockInD,
      clockOut: clockOutD,
      source: "MANUAL_ADMIN",
      notes: parsed.data.notes,
    },
    { id: session.user.id, role: session.user.role },
  );

  revalidatePath("/time");
  revalidatePath(`/payroll/${period.id}`);
  redirect(`/payroll/${period.id}`);
}
