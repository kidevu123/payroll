import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAnyUser } from "@/lib/db/queries/users";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (!(await hasAnyUser())) redirect("/setup");
  const session = await auth();
  if (session) redirect("/");

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-[--text-muted] mb-6">
          Welcome back. Use the email and password your administrator gave you.
        </p>
        <LoginForm />
        <p className="mt-6 text-xs text-[--text-subtle]">
          Forgot your password?{" "}
          <Link href="/login/reset" className="underline underline-offset-2">
            Reset it
          </Link>
        </p>
      </div>
    </main>
  );
}
