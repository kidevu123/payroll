import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEmployee } from "@/lib/db/queries/employees";
import { listShifts } from "@/lib/db/queries/shifts";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import {
  EmployeeForm,
  type ScheduleOption,
  type ShiftOption,
} from "../../employee-form";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [employee, shifts, schedules] = await Promise.all([
    getEmployee(id),
    listShifts({ includeArchived: false }),
    listSchedules({ includeInactive: true }),
  ]);
  if (!employee) notFound();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/employees/${employee.id}`}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <div>
        <h1 className="text-title font-semibold tracking-tight">Edit employee</h1>
        <p className="text-sm text-text-muted">
          Set hourly rate and payroll status here. Rate changes are tracked in
          history so past pay runs stay accurate.
        </p>
      </div>
      <EmployeeForm
        shifts={shifts.map((s) => ({ id: s.id, name: s.name }) satisfies ShiftOption)}
        schedules={schedules.map(
          (s) =>
            ({
              id: s.id,
              name: s.name,
              periodKind: s.periodKind,
              active: s.active,
            }) satisfies ScheduleOption,
        )}
        mode="edit"
        employee={employee}
      />
    </div>
  );
}
