// First-run setup. The system creates exactly one OWNER (§13). All others are
// invited from the admin UI.

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasAnyUser } from "@/lib/db/queries/users";
import { AuthLayout } from "@/components/brand/auth-layout";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");
  const t = await getTranslations("setup");
  return (
    <AuthLayout
      eyebrow={t("eyebrow")}
      title={t("createOwnerTitle")}
      description={t("createOwnerDescription")}
    >
      <SetupForm />
    </AuthLayout>
  );
}
