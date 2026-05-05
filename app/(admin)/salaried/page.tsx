// Dedicated salaried employee tab. Lists every active salaried employee
// with their existing W2 / paystub uploads + an upload slot per period.
// Decoupled from the punch-driven payroll run flow — salaried staff are
// paid externally and never appear in time/payroll grids.

import Link from "next/link";
import { Briefcase, Pencil } from "lucide-react";
import { listEmployees } from "@/lib/db/queries/employees";
import { listEmployeeVisibleDocs } from "@/lib/db/queries/payroll-documents";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/domain/avatar";
import { SalariedUploadSlot } from "./salaried-upload-slot";

export const dynamic = "force-dynamic";

export default async function SalariedPage() {
  const all = await listEmployees({ status: "ACTIVE" });
  const salaried = all.filter((e) => e.payType === "SALARIED");

  if (salaried.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-title font-semibold tracking-tight">Salaried</h1>
          <p className="text-sm text-text-muted">
            Salaried employees are paid externally (W2). Upload paystubs here
            and they appear on each employee&apos;s portal under Pay.
          </p>
        </div>
        <EmptyState
          icon={Briefcase}
          title="No salaried employees yet"
          description={`Set an employee's classification to "Salaried (W2)" on their profile.`}
          action={
            <Button asChild variant="secondary">
              <Link href="/employees">Open employees</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Pull each salaried employee's uploaded docs in parallel.
  const docsByEmployee = await Promise.all(
    salaried.map(async (e) => ({
      employee: e,
      docs: await listEmployeeVisibleDocs(e.id),
    })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold tracking-tight">Salaried</h1>
          <p className="text-sm text-text-muted">
            Upload W2 / paystub documents for salaried staff. Each employee
            sees their own documents on their Pay tab.
          </p>
        </div>
        <span className="text-xs text-text-muted shrink-0">
          {salaried.length} {salaried.length === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="space-y-3">
        {docsByEmployee.map(({ employee, docs }) => (
          <Card key={employee.id}>
            <CardHeader className="py-3 flex flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={employee.displayName} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {employee.displayName}
                    </span>
                    <span className="text-[11px] text-text-subtle tabular-nums">
                      {docs.length} {docs.length === 1 ? "doc" : "docs"}
                    </span>
                  </div>
                  <div className="text-xs text-text-subtle truncate">
                    {employee.email} · hired {employee.hiredOn}
                  </div>
                </div>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/employees/${employee.id}`}>
                  <Pencil className="h-4 w-4" /> Profile
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="py-3">
              <SalariedUploadSlot
                employeeId={employee.id}
                docs={docs.map((d) => ({
                  id: d.id,
                  originalFilename: d.originalFilename,
                  kind: d.kind,
                  uploadedAt: d.uploadedAt.toISOString(),
                  payPeriodStart: d.payPeriodStart,
                  payPeriodEnd: d.payPeriodEnd,
                  amountCents: d.amountCents,
                  zohoExpenseId: d.zohoExpenseId,
                }))}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
