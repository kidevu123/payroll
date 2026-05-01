import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAnyUser } from "@/lib/db/queries/users";
import { AuthLayout } from "@/components/brand/auth-layout";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (!(await hasAnyUser())) redirect("/setup");
  const session = await auth();
  if (session) redirect("/");

  return (
    <AuthLayout
      eyebrow="Sign in"
      title="Welcome back"
      description="Use the email and password your administrator gave you."
      footer={
        <>
          Forgot your password?{" "}
          <Link href="/login/reset" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Reset it
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}
