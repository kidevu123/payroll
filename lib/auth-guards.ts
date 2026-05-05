// Authorization helpers. Use in server actions and route handlers — middleware
// only redirects, actions enforce. Defense in depth (§13).

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

type Role = "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "EMPLOYEE";

export async function requireSession() {
  const session = await auth();
  if (!session) redirect("/login");
  // If an admin issued this user a temporary password, force a rotate
  // before they can hit anything else. /login/change-password is
  // whitelisted in middleware so this redirect doesn't loop.
  if (session.user.mustChangePassword) {
    redirect("/login/change-password");
  }
  return session;
}

/**
 * Variant of requireSession that does NOT enforce the must-change-password
 * redirect. Used by /login/change-password itself so the user can land on
 * the page they're being redirected to.
 */
export async function requireSessionAllowingPasswordChange() {
  const session = await auth();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(...roles: Role[]) {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    // Authenticated but not authorized → bounce to home, never return.
    redirect("/");
  }
  return session;
}

/**
 * "Admin-grade" gate. Owner + Admin both qualify; PAYROLL_STAFF is
 * also accepted everywhere `requireAdmin` is the gate — it's a
 * scoped sub-admin that can run payroll but cannot do owner-only
 * operations (cleanup, role assignment, DB browser). Use
 * requireAdminStrict when you need to exclude PAYROLL_STAFF.
 */
export async function requireAdmin() {
  return requireRole("OWNER", "ADMIN", "PAYROLL_STAFF");
}

/**
 * Strict admin gate — excludes PAYROLL_STAFF. Use for screens that
 * change the operating shape (role assignment, cleanup, schema-ish
 * settings). The owner asked for a payroll-staff role that "shouldn't
 * have the same options as I do", so anything truly owner-flavoured
 * stays gated by requireAdminStrict / requireOwner.
 */
export async function requireAdminStrict() {
  return requireRole("OWNER", "ADMIN");
}

export async function requireOwner() {
  return requireRole("OWNER");
}
