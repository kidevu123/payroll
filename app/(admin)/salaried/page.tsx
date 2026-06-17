// Dedicated salaried employee tab. Lists every active salaried employee
// with their existing W2 / paystub uploads + an upload slot per period.
// Decoupled from the punch-driven payroll run flow — salaried staff are
// paid externally and never appear in time/payroll grids.

import Link from "next/link";
import { Briefcase, CalendarClock, Pencil } from "lucide-react";
import { listEmployees } from "@/lib/db/queries/employees";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
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

const PERIOD_KIND_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  SEMI_MONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
};

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

  // Pull each salaried employee's docs + a schedule lookup in parallel.
  const [docsByEmployee, schedules] = await Promise.all([
    Promise.all(
      salaried.map(async (e) => ({
        employee: e,
        docs: await listEmployeeVisibleDocs(e.id),
      })),
    ),
    listSchedules(),
  ]);

  const scheduleById = new Map(schedules.map((s) => [s.id, s]));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-title font-semibold tracking-tight">Salaried</h1>
          <p className="text-sm text-text-muted">
            Upload W2 / paystub documents for salaried staff. Each employee
            sees their own documents on their Pay tab.
          </p>
        </div>
        <span className="shrink-0 rounded-chip bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-muted tabular-nums ring-1 ring-inset ring-border/70">
          {salaried.length} {salaried.length === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="space-y-4">
        {docsByEmployee.map(({ employee, docs }) => {
          const schedule = employee.payScheduleId
            ? scheduleById.get(employee.payScheduleId)
            : null;
          return (
            <Card
              key={employee.id}
              className="overflow-hidden transition-shadow hover:shadow-card-strong"
            >
              <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 bg-surface-2/40 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={employee.displayName}
                    size="md"
                    photoUrl={
                      employee.photoPath
                        ? `/api/employees/${employee.id}/photo?v=${employee.id.slice(0, 8)}`
                        : null
                    }
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold tracking-tight text-text">
                        {employee.displayName}
                      </span>
                      <span className="shrink-0 rounded-chip bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-text-muted tabular-nums">
                        {docs.length} {docs.length === 1 ? "doc" : "docs"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {schedule ? (
                        <span className="inline-flex items-center gap-1 rounded-chip bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
                          <CalendarClock className="h-3 w-3" />
                          {PERIOD_KIND_LABEL[schedule.periodKind] ??
                            schedule.periodKind}
                        </span>
                      ) : (
                        <Link
                          href={`/employees/${employee.id}`}
                          className="inline-flex items-center gap-1 rounded-chip bg-warn-50 px-2 py-0.5 text-[10px] font-medium text-warn-700 ring-1 ring-inset ring-warn-200 underline-offset-2 hover:underline"
                        >
                          <CalendarClock className="h-3 w-3" />
                          No schedule — set one
                        </Link>
                      )}
                      <span className="truncate text-xs text-text-subtle">
                        {employee.email}
                      </span>
                    </div>
                  </div>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/employees/${employee.id}`}>
                    <Pencil className="h-4 w-4" /> Profile
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="py-4">
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
          );
        })}
      </div>
    </div>
  );
}
