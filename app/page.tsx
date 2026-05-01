import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAnyUser } from "@/lib/db/queries/users";

// Root entry point.
//   • No users yet → first-run setup
//   • Signed-in admin/owner → admin dashboard
//   • Signed-in employee → employee home
//   • Otherwise → login
export default async function RootPage() {
  if (!(await hasAnyUser())) {
    redirect("/setup");
  }
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  if (session.user.role === "OWNER" || session.user.role === "ADMIN") {
    redirect("/dashboard");
  }
  redirect("/me/home");
}
