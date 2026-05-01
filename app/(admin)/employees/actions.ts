"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import {
  archiveEmployee,
  createEmployee,
  updateEmployee,
} from "@/lib/db/queries/employees";
import { addRate } from "@/lib/db/queries/rate-history";

const idSchema = z.string().uuid();

const createSchema = z.object({
  displayName: z.string().min(1).max(120),
  legalName: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().max(40).optional().nullable(),
  hiredOn: z.string().date(),
  shiftId: z.string().uuid().optional().nullable(),
  payType: z.enum(["HOURLY", "FLAT_TASK", "SALARIED"]),
  payScheduleId: z.string().uuid().optional().nullable(),
  initialHourlyRateCents: z
    .union([z.coerce.number().int().min(0), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  language: z.enum(["en", "es"]).default("en"),
  notes: z.string().max(2000).optional().nullable(),
  requiresW2Upload: z.union([z.literal("1"), z.literal("0")]).optional(),
  ngtecoEmployeeRef: z
    .union([z.string().max(64), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
});

export async function createEmployeeAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = createSchema.safeParse({
    displayName: formData.get("displayName"),
    legalName: formData.get("legalName") || formData.get("displayName"),
    email: formData.get("email"),
    phone: formData.get("phone") || null,
    hiredOn: formData.get("hiredOn"),
    shiftId: formData.get("shiftId") || null,
    payType: formData.get("payType") || "HOURLY",
    payScheduleId: formData.get("payScheduleId") || null,
    initialHourlyRateCents: formData.get("initialHourlyRateCents"),
    language: formData.get("language") || "en",
    notes: formData.get("notes") || null,
    requiresW2Upload: formData.get("requiresW2Upload") || "0",
    ngtecoEmployeeRef: formData.get("ngtecoEmployeeRef") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;
  const employee = await createEmployee(
    {
      displayName: d.displayName,
      legalName: d.legalName,
      email: d.email,
      phone: d.phone ?? null,
      hiredOn: d.hiredOn,
      shiftId: d.shiftId ?? null,
      payType: d.payType,
      payScheduleId: d.payScheduleId ?? null,
      language: d.language,
      notes: d.notes ?? null,
      requiresW2Upload: d.requiresW2Upload === "1",
      ngtecoEmployeeRef: d.ngtecoEmployeeRef ?? null,
      ...(d.initialHourlyRateCents !== undefined && d.initialHourlyRateCents !== null
        ? { initialHourlyRateCents: d.initialHourlyRateCents }
        : {}),
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/employees");
  redirect(`/employees/${employee.id}`);
}

const updateSchema = z.object({
  displayName: z.string().min(1).max(120),
  legalName: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().max(40).optional().nullable(),
  shiftId: z.string().uuid().optional().nullable(),
  payType: z.enum(["HOURLY", "FLAT_TASK", "SALARIED"]),
  payScheduleId: z.string().uuid().optional().nullable(),
  language: z.enum(["en", "es"]),
  notes: z.string().max(2000).optional().nullable(),
  requiresW2Upload: z.union([z.literal("1"), z.literal("0")]).optional(),
  ngtecoEmployeeRef: z
    .union([z.string().max(64), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
});

export async function updateEmployeeAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = updateSchema.safeParse({
    displayName: formData.get("displayName"),
    legalName: formData.get("legalName"),
    email: formData.get("email"),
    phone: formData.get("phone") || null,
    shiftId: formData.get("shiftId") || null,
    payType: formData.get("payType"),
    payScheduleId: formData.get("payScheduleId") || null,
    language: formData.get("language"),
    notes: formData.get("notes") || null,
    requiresW2Upload: formData.get("requiresW2Upload") || "0",
    ngtecoEmployeeRef: formData.get("ngtecoEmployeeRef") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;
  await updateEmployee(
    id,
    {
      displayName: d.displayName,
      legalName: d.legalName,
      email: d.email,
      phone: d.phone ?? null,
      shiftId: d.shiftId ?? null,
      payType: d.payType,
      payScheduleId: d.payScheduleId ?? null,
      language: d.language,
      notes: d.notes ?? null,
      requiresW2Upload: d.requiresW2Upload === "1",
      ngtecoEmployeeRef: d.ngtecoEmployeeRef ?? null,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
  redirect(`/employees/${id}`);
}

const archiveSchema = z.object({ reason: z.string().min(1).max(500) });

export async function archiveEmployeeAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = archiveSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  await archiveEmployee(id, parsed.data.reason, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  redirect("/employees");
}

const rateSchema = z.object({
  effectiveFrom: z.string().date(),
  hourlyRateCents: z.coerce.number().int().min(0),
  reason: z.string().max(500).optional().nullable(),
});

export async function addRateAction(
  employeeId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(employeeId).success) return { error: "Invalid id." };
  const parsed = rateSchema.safeParse({
    effectiveFrom: formData.get("effectiveFrom"),
    hourlyRateCents: formData.get("hourlyRateCents"),
    reason: formData.get("reason") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await addRate(
    employeeId,
    {
      effectiveFrom: parsed.data.effectiveFrom,
      hourlyRateCents: parsed.data.hourlyRateCents,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath(`/employees/${employeeId}`);
  redirect(`/employees/${employeeId}`);
}
