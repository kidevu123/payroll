import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEmployee } from "@/lib/db/queries/employees";
import { listShifts } from "@/lib/db/queries/shifts";
import { EmployeeForm } from "../../employee-form";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [employee, shifts] = await Promise.all([
    getEmployee(id),
    listShifts({ includeArchived: false }),
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
        <h1 className="text-2xl font-semibold">Edit employee</h1>
        <p className="text-sm text-[--text-muted]">
          Rate changes are tracked separately so historical pay computations
          don&apos;t shift.
        </p>
      </div>
      <EmployeeForm shifts={shifts} mode="edit" employee={employee} />
    </div>
  );
}
