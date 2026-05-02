// /punches/wipe — owner-only bulk soft-delete (void) of punches by date.
// Per spec, voided rows stay in the DB but stop counting in compute.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth-guards";
import { WipePunchesPanel } from "./wipe-panel";

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
          Wipe punches (soft-delete)
        </h1>
        <p className="text-sm text-text-muted">
          Marks every non-voided punch from the chosen date forward as voided.
          The rows stay in the database (per spec), but computePay and
          payslip-recompute will ignore them. Reversible if you have row IDs.
        </p>
      </div>
      <WipePunchesPanel />
    </div>
  );
}

export const dynamic = "force-dynamic";
