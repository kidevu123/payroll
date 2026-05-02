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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { SalariedUploadSlot } from "./salaried-upload-slot";

export const dynamic = "force-dynamic";

export default async function SalariedPage() {
  const all = await listEmployees({ status: "ACTIVE" });
  const salaried = all.filter((e) => e.payType === "SALARIED");

  if (salaried.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Salaried</h1>
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Salaried</h1>
        <p className="text-sm text-text-muted">
          Upload W2 / paystub documents for salaried staff. Each employee
          sees their own documents on their Pay tab.
        </p>
      </div>

      <div className="space-y-4">
        {docsByEmployee.map(({ employee, docs }) => (
          <Card key={employee.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-purple-700" />
                  {employee.displayName}
                </CardTitle>
                <CardDescription>
                  {employee.email} · hired {employee.hiredOn}
                  {docs.length > 0
                    ? ` · ${docs.length} document${docs.length === 1 ? "" : "s"} uploaded`
                    : " · no documents yet"}
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/employees/${employee.id}`}>
                  <Pencil className="h-4 w-4" /> Profile
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
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
                }))}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
