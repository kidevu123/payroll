// Authorization helpers. Use in server actions and route handlers — middleware
// only redirects, actions enforce. Defense in depth (§13).

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

type Role = "OWNER" | "ADMIN" | "EMPLOYEE";

export async function requireSession() {
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

export async function requireAdmin() {
  return requireRole("OWNER", "ADMIN");
}

export async function requireOwner() {
  return requireRole("OWNER");
}
