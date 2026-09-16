import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { hasAnyUser } from "@/lib/db/queries/users";
import { AuthLayout } from "@/components/brand/auth-layout";
import { LoginForm } from "./login-form";
import { SsoSignInForm } from "./sso-sign-in-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  if (!(await hasAnyUser())) redirect("/setup");
  const session = await auth();
  if (session) redirect("/");
  const t = await getTranslations("auth");
  const { from, error } = await searchParams;
  const oidcEnabled = Boolean(process.env.AUTHENTIK_CLIENT_ID);

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
      <div className="space-y-5">
        {oidcEnabled && (
          <>
            {error === "AccessDenied" && (
              <div className="rounded-input border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800">
                That account is not set up in payroll yet. Ask the office to add you.
              </div>
            )}
            {/*
             * Auth.js collapses every other refusal reason (provider
             * outage, network error, misconfiguration) into error values
             * this page cannot tell apart -- so this is a single neutral
             * fallback, not a per-reason message. Plain English for
             * warehouse staff: no internal system names, no log
             * references.
             */}
            {error && error !== "AccessDenied" && (
              <div className="rounded-input border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800">
                Something went wrong signing in. Try again, or ask the office for help.
              </div>
            )}
            <SsoSignInForm callbackUrl={from || "/"} />
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <hr className="flex-1" />
              <span>or sign in with email</span>
              <hr className="flex-1" />
            </div>
          </>
        )}
        <LoginForm oidcEnabled={oidcEnabled} />
      </div>
    </AuthLayout>
  );
}
