import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signIn } from "@/lib/auth";
import { hasAnyUser } from "@/lib/db/queries/users";
import { AuthLayout } from "@/components/brand/auth-layout";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  if (!(await hasAnyUser())) redirect("/setup");
  const session = await auth();
  if (session) redirect("/");
  const t = await getTranslations("auth");
  const { from } = await searchParams;
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
            <form
              action={async () => {
                "use server";
                await signIn("authentik", { redirectTo: from || "/" });
              }}
            >
              <Button type="submit" size="lg" className="w-full">
                Sign in with SSO
              </Button>
            </form>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
