import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAnyUser } from "@/lib/db/queries/users";
import { effectiveSurfacesFor } from "@/lib/auth/role-matrix";

// Root entry point.
//   • No users yet → first-run setup
//   • Employee → employee home
//   • Owner / Admin / Payroll-staff / Accountant → first allowed admin
//     surface from the role × surface matrix (owner can reshape this at
//     /settings/roles, so routing tracks it automatically). Defaults:
//     Owner/Admin/Payroll → /dashboard, Accountant → /dashboard then /cash-drawer.
//   • Otherwise → login
export default async function RootPage() {
  if (!(await hasAnyUser())) {
    redirect("/setup");
  }
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  if (session.user.role === "EMPLOYEE") {
    redirect("/me/home");
  }
  const allowed = await effectiveSurfacesFor(session.user.role);
  redirect(allowed[0] ?? "/dashboard");
}
