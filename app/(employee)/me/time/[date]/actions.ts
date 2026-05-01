"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth-guards";
import {
  createMissedPunchRequest,
} from "@/lib/db/queries/requests";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";

const schema = z.object({
  date: z.string().date(),
  claimedClockIn: z.string().min(1),
  claimedClockOut: z.string().optional().nullable(),
  reason: z.string().min(1).max(500),
});

/**
 * Report a punch fix from the day-detail page. Unlike the alert-driven
 * flow this doesn't require a missedPunchAlert row — the employee can
 * file the request whenever they spot a mistake. The admin reviews on
 * /requests just like the alert-driven ones.
 */
export async function reportPunchFixAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Account not linked." };
  const parsed = schema.safeParse({
    date: formData.get("date"),
    claimedClockIn: formData.get("claimedClockIn"),
    claimedClockOut: formData.get("claimedClockOut") || null,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const inDate = new Date(parsed.data.claimedClockIn);
  if (Number.isNaN(inDate.getTime())) return { error: "Invalid in time." };
  let outDate: Date | null = null;
  if (parsed.data.claimedClockOut) {
    outDate = new Date(parsed.data.claimedClockOut);
    if (Number.isNaN(outDate.getTime())) return { error: "Invalid out time." };
  }

  // Find a period that contains the date.
  const [period] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.startDate, parsed.data.date));
  // Fall back to any period covering this date.
  const periodId = period?.id ?? null;
  if (!periodId) {
    return {
      error: "No pay period covers that date yet — ask an admin to open one.",
    };
  }

  await createMissedPunchRequest(
    {
      employeeId: session.user.employeeId,
      periodId,
      date: parsed.data.date,
      claimedClockIn: inDate,
      claimedClockOut: outDate,
      reason: parsed.data.reason,
    },
    { id: session.user.id, role: session.user.role },
  );

  revalidatePath(`/me/time/${parsed.data.date}`);
  redirect(`/me/time/${parsed.data.date}?reported=1`);
}
