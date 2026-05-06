"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth-guards";
import { setSetting } from "@/lib/settings/runtime";
import { rolePermissionsSchema } from "@/lib/settings/schemas";
import { SURFACES, defaultSurfacesFor, type EditableRole } from "@/lib/auth/role-matrix";
import {
  createStaffUser,
  generateTempPasswordForUser,
  setUserDisabled,
  setUserRole,
} from "@/lib/db/queries/users";

const ROLES = ["PAYROLL_STAFF", "ACCOUNTANT", "ADMIN"] as const;

const surfaceSchema = z.enum(SURFACES);

const overrideSchema = z.object({
  PAYROLL_STAFF: z.array(surfaceSchema).optional(),
  ACCOUNTANT: z.array(surfaceSchema).optional(),
  ADMIN: z.array(surfaceSchema).optional(),
});

/**
 * Save the role × surface matrix.
 *
 * The form posts each cell as `${role}:${surface}` = "on" when checked. We
 * collect the checked surfaces per role and persist as the override map.
 *
 * If a role's resolved set matches its default exactly we drop the override
 * entry — keeps the setting record minimal and means future default tweaks
 * automatically apply unless the owner has explicitly diverged.
 */
export async function saveRolePermissions(
  formData: FormData,
): Promise<{ error?: string; ok?: true } | void> {
  const session = await requireOwner();
  const collected: Record<EditableRole, string[]> = {
    PAYROLL_STAFF: [],
    ACCOUNTANT: [],
    ADMIN: [],
  };
  for (const [key, value] of formData.entries()) {
    if (value !== "on") continue;
    const sep = key.indexOf(":");
    if (sep < 0) continue;
    const role = key.slice(0, sep);
    const surface = key.slice(sep + 1);
    if (!ROLES.includes(role as EditableRole)) continue;
    collected[role as EditableRole].push(surface);
  }

  const overrides: Partial<Record<EditableRole, string[]>> = {};
  for (const role of ROLES) {
    const checked = new Set(collected[role]);
    const def = new Set(defaultSurfacesFor(role));
    const sameAsDefault =
      checked.size === def.size &&
      [...checked].every((s) => def.has(s as never));
    if (!sameAsDefault) {
      overrides[role] = [...checked];
    }
  }

  const parsed = rolePermissionsSchema.safeParse({
    overrides: overrideSchema.parse(overrides),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await setSetting("rolePermissions", parsed.data, {
    actorId: session.user.id,
    actorRole: session.user.role,
  });
  revalidatePath("/settings/roles");
  return { ok: true };
}

export async function resetRolePermissions(): Promise<{ ok?: true } | void> {
  const session = await requireOwner();
  await setSetting(
    "rolePermissions",
    { overrides: {} },
    { actorId: session.user.id, actorRole: session.user.role },
  );
  revalidatePath("/settings/roles");
  return { ok: true };
}

// ─── Staff-user management ───────────────────────────────────────────
// Standalone logins for accountants / payroll-staff / admins that
// don't punch a clock. Distinct from the Employee invite flow on
// /employees/[id] (which links the User to an Employee row + shift).

const staffSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(["ADMIN", "PAYROLL_STAFF", "ACCOUNTANT"]),
});

export async function createStaffUserAction(
  formData: FormData,
): Promise<{ error?: string; tempPassword?: string } | void> {
  const session = await requireOwner();
  const parsed = staffSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    const { tempPassword } = await createStaffUser(parsed.data, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/roles");
    return { tempPassword };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

const idSchema = z.string().uuid();

export async function regenerateStaffTempPasswordAction(
  userId: string,
): Promise<{ error?: string; tempPassword?: string } | void> {
  const session = await requireOwner();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  try {
    const tempPassword = await generateTempPasswordForUser(userId, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/roles");
    return { tempPassword };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function setStaffDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<{ error?: string } | void> {
  const session = await requireOwner();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  try {
    await setUserDisabled(userId, disabled, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/roles");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}

const staffRoleSchema = z.object({
  role: z.enum(["ADMIN", "PAYROLL_STAFF", "ACCOUNTANT"]),
});

export async function setStaffRoleAction(
  userId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireOwner();
  if (!idSchema.safeParse(userId).success) return { error: "Invalid id." };
  const parsed = staffRoleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) return { error: "Invalid role." };
  try {
    await setUserRole(userId, parsed.data.role, {
      id: session.user.id,
      role: session.user.role,
    });
    revalidatePath("/settings/roles");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}
