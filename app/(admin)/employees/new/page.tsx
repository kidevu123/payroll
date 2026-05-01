import { listActiveShifts } from "@/lib/db/queries/shifts";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { EmployeeForm } from "../employee-form";

export default async function NewEmployeePage() {
  const [shifts, schedules] = await Promise.all([
    listActiveShifts(),
    listSchedules(),
  ]);
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New employee</h1>
        <p className="text-sm text-text-muted">
          Hourly rate becomes the first row in the rate-history timeline.
        </p>
      </div>
      <EmployeeForm shifts={shifts} schedules={schedules} mode="create" />
    </div>
  );
}
