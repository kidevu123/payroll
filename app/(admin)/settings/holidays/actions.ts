"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import { createHoliday, deleteHoliday } from "@/lib/db/queries/holidays";

const createSchema = z.object({
  date: z.string().date(),
  label: z.string().min(1).max(120),
});

export async function createHolidayAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = createSchema.safeParse({
    date: formData.get("date"),
    label: formData.get("label"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await createHoliday(parsed.data.date, parsed.data.label, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/holidays");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed.";
    return { error: msg.includes("unique") ? "Already a holiday on that date." : msg };
  }
}

export async function deleteHolidayAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid id." };
  await deleteHoliday(id, { id: session.user.id, role: session.user.role });
  revalidatePath("/settings/holidays");
}
