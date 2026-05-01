"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guards";
import {
  createSchedule,
  updateSchedule,
} from "@/lib/db/queries/pay-schedules";

const idSchema = z.string().uuid();

const baseSchema = z.object({
  name: z.string().min(1).max(80),
  periodKind: z.enum(["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"]),
  startDayOfWeek: z
    .union([z.coerce.number().int().min(0).max(6), z.literal("").transform(() => null)])
    .nullable(),
  anchorDate: z
    .union([z.string().date(), z.literal("").transform(() => null)])
    .nullable(),
  cron: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[\d*/,\- ]+$/, "Cron must use only digits, *, /, ,, -, and spaces"),
  active: z
    .union([z.literal("on").transform(() => true), z.literal("off").transform(() => false)])
    .or(z.boolean())
    .default(true),
});

function parseFormFields(formData: FormData) {
  return baseSchema.safeParse({
    name: formData.get("name"),
    periodKind: formData.get("periodKind"),
    startDayOfWeek: formData.get("startDayOfWeek"),
    anchorDate: formData.get("anchorDate"),
    cron: formData.get("cron"),
    active: formData.get("active") ?? "on",
  });
}

export async function createScheduleAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = parseFormFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;
  await createSchedule(
    {
      name: v.name,
      periodKind: v.periodKind,
      startDayOfWeek: v.periodKind === "WEEKLY" || v.periodKind === "BIWEEKLY" ? (v.startDayOfWeek ?? 1) : null,
      anchorDate: v.periodKind === "BIWEEKLY" ? v.anchorDate : null,
      cron: v.cron,
      active: v.active,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/settings/pay-schedules");
}

export async function updateScheduleAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = parseFormFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;
  await updateSchedule(
    id,
    {
      name: v.name,
      periodKind: v.periodKind,
      startDayOfWeek: v.periodKind === "WEEKLY" || v.periodKind === "BIWEEKLY" ? (v.startDayOfWeek ?? 1) : null,
      anchorDate: v.periodKind === "BIWEEKLY" ? v.anchorDate : null,
      cron: v.cron,
      active: v.active,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/settings/pay-schedules");
}

export async function toggleActiveAction(
  id: string,
  active: boolean,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await updateSchedule(
    id,
    { active },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/settings/pay-schedules");
}
