"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import {
  archiveShift,
  createShift,
  reorderShifts,
  updateShift,
} from "@/lib/db/queries/shifts";

const idSchema = z.string().uuid();

const createSchema = z.object({
  name: z.string().min(1).max(80),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a 6-digit hex color")
    .default("#0f766e"),
  defaultStart: z.union([z.string(), z.literal("").transform(() => null)]).nullable(),
  defaultEnd: z.union([z.string(), z.literal("").transform(() => null)]).nullable(),
});

export async function createShiftAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    colorHex: formData.get("colorHex") || "#0f766e",
    defaultStart: formData.get("defaultStart"),
    defaultEnd: formData.get("defaultEnd"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await createShift(
    {
      name: parsed.data.name,
      colorHex: parsed.data.colorHex,
      defaultStart: parsed.data.defaultStart,
      defaultEnd: parsed.data.defaultEnd,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/settings/shifts");
}

const updateSchema = createSchema;

export async function updateShiftAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = updateSchema.safeParse({
    name: formData.get("name"),
    colorHex: formData.get("colorHex") || "#0f766e",
    defaultStart: formData.get("defaultStart"),
    defaultEnd: formData.get("defaultEnd"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await updateShift(
    id,
    {
      name: parsed.data.name,
      colorHex: parsed.data.colorHex,
      defaultStart: parsed.data.defaultStart,
      defaultEnd: parsed.data.defaultEnd,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/settings/shifts");
}

export async function archiveShiftAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await archiveShift(id, { id: session.user.id, role: session.user.role });
  revalidatePath("/settings/shifts");
}

export async function reorderShiftsAction(
  orderedIds: string[],
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  for (const id of orderedIds) {
    if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  }
  await reorderShifts(orderedIds, { id: session.user.id, role: session.user.role });
  revalidatePath("/settings/shifts");
}
