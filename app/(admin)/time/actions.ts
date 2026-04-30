"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import { createPunch, editPunch, voidPunch } from "@/lib/db/queries/punches";

const createSchema = z.object({
  employeeId: z.string().uuid(),
  periodId: z.string().uuid(),
  clockIn: z.string().min(1),
  clockOut: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function createPunchAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = createSchema.safeParse({
    employeeId: formData.get("employeeId"),
    periodId: formData.get("periodId"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const clockInD = new Date(parsed.data.clockIn);
  const clockOutD = parsed.data.clockOut ? new Date(parsed.data.clockOut) : null;
  if (Number.isNaN(clockInD.getTime())) return { error: "Invalid clock-in." };
  if (clockOutD && Number.isNaN(clockOutD.getTime())) {
    return { error: "Invalid clock-out." };
  }
  await createPunch(
    {
      employeeId: parsed.data.employeeId,
      periodId: parsed.data.periodId,
      clockIn: clockInD,
      clockOut: clockOutD,
      source: "MANUAL_ADMIN",
      notes: parsed.data.notes ?? null,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/time");
  redirect(`/time/${parsed.data.periodId}/${formData.get("date")}/${parsed.data.employeeId}`);
}

const editSchema = z.object({
  clockIn: z.string().min(1),
  clockOut: z.string().optional().nullable(),
  reason: z.string().min(1).max(500),
  notes: z.string().max(500).optional().nullable(),
});

export async function editPunchAction(
  punchId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = editSchema.safeParse({
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || null,
    reason: formData.get("reason"),
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const clockInD = new Date(parsed.data.clockIn);
  const clockOutD = parsed.data.clockOut ? new Date(parsed.data.clockOut) : null;
  if (Number.isNaN(clockInD.getTime())) return { error: "Invalid clock-in." };
  if (clockOutD && Number.isNaN(clockOutD.getTime())) {
    return { error: "Invalid clock-out." };
  }
  await editPunch(
    punchId,
    { clockIn: clockInD, clockOut: clockOutD, notes: parsed.data.notes ?? null },
    parsed.data.reason,
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/time");
}

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export async function voidPunchAction(
  punchId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = voidSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  await voidPunch(punchId, parsed.data.reason, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath("/time");
}
