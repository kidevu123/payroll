import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { hasAnyUser } from "@/lib/db/queries/users";
import { AuthLayout } from "@/components/brand/auth-layout";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (!(await hasAnyUser())) redirect("/setup");
  const session = await auth();
  if (session) redirect("/");
  const t = await getTranslations("auth");

  return (
    <AuthLayout
      eyebrow={t("signIn")}
      title={t("welcomeBack")}
      description={t("welcomeBackDescription")}
      footer={
        <>
          {t("forgotPassword")}{" "}
          <Link href="/login/reset" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
            {t("resetIt")}
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}
