import { requireSession } from "@/lib/auth-guards";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function EmployeeHome() {
  const session = await requireSession();
  return (
    <main className="min-h-dvh px-5 py-6 max-w-md mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Hi, {session.user.email}</h1>
        <p className="text-sm text-[--text-muted]">
          The employee app ships in Phase 4. You can sign in here today; the rest comes online soon.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>This week</CardTitle>
          <CardDescription>Hours and projected pay will appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[--text-muted]">No data yet.</p>
        </CardContent>
      </Card>
    </main>
  );
}
