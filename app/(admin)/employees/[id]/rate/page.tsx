import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEmployee } from "@/lib/db/queries/employees";
import { listRates } from "@/lib/db/queries/rate-history";
import { RateHistoryList } from "@/components/domain/rate-history-list";
import { addRateAction } from "../../actions";
import { RateForm } from "./rate-form";

export default async function AddRatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) notFound();
  const rates = await listRates(id);
  const action = addRateAction.bind(null, id);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/employees/${id}`}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold">Add rate change</h1>
        <p className="text-sm text-[--text-muted]">
          Past-dated effective dates are allowed for corrections. The reason
          appears in the audit log.
        </p>
      </div>
      <RateForm action={action} />
      <div>
        <h2 className="text-lg font-semibold mb-2">History</h2>
        <RateHistoryList rates={rates} />
      </div>
    </div>
  );
}
