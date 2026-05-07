"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminStrict } from "@/lib/auth-guards";
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
  // Add an upper bound to defend the Argon2id hasher (and avoid storing
  // an absurdly long string into users.password_hash). 8-200 chars
  // covers any reasonable password manager output.
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password.length > 200) return { error: "Password must be 200 characters or fewer." };
  try {
    await setPasswordForUser(userId, password, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath(`/employees`, "layout");
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
    revalidatePath(`/employees`, "layout");
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
    revalidatePath(`/employees`, "layout");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

const roleSchema = z.object({ role: z.enum(["EMPLOYEE", "PAYROLL_STAFF", "ACCOUNTANT", "ADMIN"]) });

export async function setRoleAction(
  userId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  // Owner + Admin only — payroll staff can't promote anyone.
  const session = await requireAdminStrict();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  const parsed = roleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) return { error: "Invalid role." };
  try {
    await setUserRole(userId, parsed.data.role, {
      id: session.user.id,
      role: session.user.role,
    });
    // Layout scope: the form lives at /employees/[id], not the index;
    // revalidating only `/employees` left the detail page showing the
    // pre-save role and looked like the action silently no-op'd.
    revalidatePath(`/employees`, "layout");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["EMPLOYEE", "PAYROLL_STAFF", "ACCOUNTANT", "ADMIN"]),
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
    revalidatePath(`/employees`, "layout");
    return { tempPassword: result.tempPassword };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}
