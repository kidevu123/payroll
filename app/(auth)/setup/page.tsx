// First-run setup. The system creates exactly one OWNER (§13). All others are
// invited from the admin UI.

import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/db/queries/users";
import { AuthLayout } from "@/components/brand/auth-layout";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");
  return (
    <AuthLayout
      eyebrow="First-run setup"
      title="Create your owner account"
      description="You'll be the only person with access until you invite others."
    >
      <SetupForm />
    </AuthLayout>
  );
}
