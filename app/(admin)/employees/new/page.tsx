import { listActiveShifts } from "@/lib/db/queries/shifts";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { EmployeeForm } from "../employee-form";

export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams: Promise<{ ngtecoRef?: string; displayName?: string }>;
}) {
  const [shifts, schedules, params] = await Promise.all([
    listActiveShifts(),
    listSchedules(),
    searchParams,
  ]);
  // Optional prefill from the CSV upload preview's "Add as new" link.
  // Admin goes from "No match (ref: 47)" → click → land here with the
  // ref + name already filled in.
  const prefillNgtecoRef = params.ngtecoRef?.slice(0, 64);
  const prefillDisplayName = params.displayName?.slice(0, 120);
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New employee</h1>
        <p className="text-sm text-text-muted">
          Hourly rate becomes the first row in the rate-history timeline.
          {prefillNgtecoRef && (
            <span className="block mt-1 text-xs text-amber-700">
              Prefilled from a CSV upload — confirm name and fill the rate.
            </span>
          )}
        </p>
      </div>
      <EmployeeForm
        shifts={shifts}
        schedules={schedules}
        mode="create"
        prefill={{
          ...(prefillDisplayName ? { displayName: prefillDisplayName } : {}),
          ...(prefillNgtecoRef ? { ngtecoEmployeeRef: prefillNgtecoRef } : {}),
        }}
      />
    </div>
  );
}
