// /punches/wipe — owner-only data-cleanup tools.
//   - Bulk soft-delete (void) punches by clock_in date
//   - Hard-delete OPEN pay periods that have no punches + no runs
// Per spec, punches are soft-deleted (voided_at). Pay periods are
// hard-deleted only when they're empty shells.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth-guards";
import { WipePunchesPanel } from "./wipe-panel";
import { WipeEmptyPeriodsPanel } from "./wipe-empty-periods-panel";

export default async function WipePunchesPage() {
  await requireOwner();
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/time">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Data cleanup
        </h1>
        <p className="text-sm text-text-muted">
          Owner-only reset tools. Use sparingly.
        </p>
      </div>
      <WipePunchesPanel />
      <WipeEmptyPeriodsPanel />
    </div>
  );
}

export const dynamic = "force-dynamic";
