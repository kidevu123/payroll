// First-run setup. The system creates exactly one OWNER (§13). All others are
// invited from the admin UI.

import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/db/queries/users";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");
  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold mb-1">Welcome</h1>
        <p className="text-sm text-[--text-muted] mb-6">
          Let&apos;s create your owner account. You&apos;ll be the only person
          with access until you invite others.
        </p>
        <SetupForm />
      </div>
    </main>
  );
}
