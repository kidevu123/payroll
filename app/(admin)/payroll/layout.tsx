// Server-side surface guard. The (admin) layout already does a
// path-based redirect, but defense-in-depth: this guarantees the
// role × surface matrix is enforced for /payroll/* even if the
// middleware-injected x-pathname header is somehow missing.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import {
  canAccessSurface,
  isAccountantPeriodReviewPath,
} from "@/lib/auth/role-matrix";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const h = await headers();
  const pathname = h.get("x-pathname") ?? h.get("x-invoke-path") ?? "";
  const accountantPeriodReview =
    session.user.role === "ACCOUNTANT" &&
    isAccountantPeriodReviewPath(pathname);
  const canUsePayroll = await canAccessSurface(session.user.role, "/payroll");
  if (!accountantPeriodReview && !canUsePayroll) redirect("/");
  return <>{children}</>;
}
