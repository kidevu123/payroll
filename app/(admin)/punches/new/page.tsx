// /punches/new — global "add manual punch" form. Pick employee + date +
// times, the server resolves which pay period it belongs to and inserts
// it there. The period_id used is whatever non-PAID period covers the
// chosen date (preferring OPEN over LOCKED); if every overlapping
// period is PAID the action errors with a clear message.

import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listEmployees } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { ManualPunchForm } from "./manual-punch-form";

export default async function ManualPunchPage() {
  const [employees, company] = await Promise.all([
    listEmployees({ status: "ACTIVE" }),
    getSetting("company"),
  ]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/time">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/punches/wipe" className="text-danger-700">
            <Trash2 className="h-4 w-4" /> Wipe punches…
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Plus className="h-6 w-6 text-brand-700" /> Add manual punch
        </h1>
        <p className="text-sm text-text-muted">
          Pick the employee + the day they worked + the times. The system
          drops it into the matching pay period automatically.
        </p>
      </div>
      <ManualPunchForm
        employees={employees.map((e) => ({
          id: e.id,
          displayName: e.displayName,
          payType: e.payType,
        }))}
        timezone={company.timezone}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
