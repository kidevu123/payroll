"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import {
  generateTempPasswordForUser,
  inviteEmployeeUser,
  setPasswordForUser,
  setUserDisabled,
  setUserRole,
} from "@/lib/db/queries/users";

const idSchema = z.string().uuid();

export async function setPasswordAction(
  userId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  try {
    await setPasswordForUser(userId, password, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath(`/employees`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function generateTempPasswordAction(
  userId: string,
): Promise<{ error?: string; tempPassword?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  try {
    const tempPassword = await generateTempPasswordForUser(userId, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath(`/employees`);
    return { tempPassword };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function toggleDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  try {
    await setUserDisabled(userId, disabled, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath(`/employees`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

const roleSchema = z.object({ role: z.enum(["EMPLOYEE", "ADMIN"]) });

export async function setRoleAction(
  userId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  const parsed = roleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) return { error: "Invalid role." };
  try {
    await setUserRole(userId, parsed.data.role, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath(`/employees`);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["EMPLOYEE", "ADMIN"]),
});

export async function inviteEmployeeAction(
  employeeId: string,
  formData: FormData,
): Promise<{ error?: string; tempPassword?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(employeeId).success) {
    return { error: "Invalid employee id." };
  }
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const result = await inviteEmployeeUser(
      { employeeId, email: parsed.data.email, role: parsed.data.role },
      { id: session.user.id, role: session.user.role },
    );
    revalidatePath(`/employees`);
    return { tempPassword: result.tempPassword };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}
