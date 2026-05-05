import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSessionAllowingPasswordChange } from "@/lib/auth-guards";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await requireSessionAllowingPasswordChange();
  // If they don't actually need to change it, send them home.
  if (!session.user.mustChangePassword) {
    redirect("/");
  }
  const t = await getTranslations("auth");
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6">
      <div className="w-full space-y-6 rounded-card border border-border bg-surface-2 p-8 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {t("changePasswordTitle")}
          </h1>
          <p className="text-sm text-text-muted">
            {t("changePasswordSubtitle")}
          </p>
        </div>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
