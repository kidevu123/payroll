"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth-guards";
import { updateEmployee } from "@/lib/db/queries/employees";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/db/audit";

const schema = z.object({
  displayName: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  language: z.enum(["en", "es"]),
  birthday: z
    .union([z.string().date(), z.literal("").transform(() => null)])
    .nullable(),
});

export async function saveProfileAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Not linked." };
  const parsed = schema.safeParse({
    displayName: formData.get("displayName"),
    phone: formData.get("phone") || null,
    language: formData.get("language") || "en",
    birthday: formData.get("birthday") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await updateEmployee(
    session.user.employeeId,
    {
      displayName: parsed.data.displayName,
      phone: parsed.data.phone ?? null,
      language: parsed.data.language,
      birthday: parsed.data.birthday ?? null,
    },
    { id: session.user.id, role: session.user.role },
  );
  revalidatePath("/me/profile");
  revalidatePath("/", "layout"); // refresh i18n locale on next render
}

const kioskPinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/),
  pinConfirm: z.string(),
});

/**
 * Employee self-service kiosk PIN. The employee is already authenticated
 * in their portal session, so no current-PIN check is needed; the hash
 * lands in the same employees.kiosk_pin_hash the admin form writes.
 * Audited without the hash in the payload.
 */
export async function setKioskPinAction(
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Account not linked." };
  const parsed = kioskPinSchema.safeParse({
    pin: formData.get("pin"),
    pinConfirm: formData.get("pinConfirm"),
  });
  if (!parsed.success) return { error: "PIN_INVALID" };
  if (parsed.data.pin !== parsed.data.pinConfirm) {
    return { error: "PIN_MISMATCH" };
  }
  const kioskPinHash = await hashPassword(parsed.data.pin);
  await db
    .update(employees)
    .set({ kioskPinHash, updatedAt: new Date() })
    .where(eq(employees.id, session.user.employeeId));
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "employee.kiosk_pin.set",
    targetType: "Employee",
    targetId: session.user.employeeId,
    after: { source: "employee_profile" },
  });
  revalidatePath("/me/profile");
  return { ok: true };
}
