// Server-side guard above the client nav. Settings is a single
// surface key in the role × surface matrix, so anyone whose
// effectiveSurfaces don't include "/settings" gets bounced before
// they can render any /settings/* sub-page. Defense in depth: the
// (admin) layout's path-based redirect is the first line; this is
// the second, and it doesn't depend on the middleware-injected
// pathname header.
//
// Owner / admin always pass. Payroll-staff and accountants only
// pass if the matrix grants them /settings access.

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import { canAccessSurface } from "@/lib/auth/role-matrix";
import { effectiveSurfacesFor } from "@/lib/auth/role-matrix";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const ok = await canAccessSurface(session.user.role, "/settings");
  if (!ok) {
    // Send them somewhere they actually have access to — the role
    // matrix gives us the answer for free.
    const allowed = await effectiveSurfacesFor(session.user.role);
    redirect(allowed[0] ?? "/");
  }
  return <SettingsNav>{children}</SettingsNav>;
}
