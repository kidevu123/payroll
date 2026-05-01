// Employee-side fix-punch form. Pre-filled with what we know from the alert.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSession } from "@/lib/auth-guards";
import { getMissedPunchAlertById } from "@/lib/db/queries/requests";
import { ExceptionBadge } from "@/components/domain/exception-badge";
import { MissedPunchForm } from "./form";

export default async function MissedPunchFixPage({
  params,
}: {
  params: Promise<{ alertId: string }>;
}) {
  const session = await requireSession();
  if (!session.user.employeeId) notFound();
  const { alertId } = await params;
  const alert = await getMissedPunchAlertById(alertId);
  if (!alert || alert.employeeId !== session.user.employeeId) notFound();

  return (
    <main className="px-4 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/me/home">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {alert.date} <ExceptionBadge issue={alert.issue} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MissedPunchForm alertId={alertId} date={alert.date} />
        </CardContent>
      </Card>
    </main>
  );
}
