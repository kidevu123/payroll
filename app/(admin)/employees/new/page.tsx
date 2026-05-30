import { listActiveShifts } from "@/lib/db/queries/shifts";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import {
  EmployeeForm,
  type ScheduleOption,
  type ShiftOption,
} from "../employee-form";

type Classification =
  | "WEEKLY_HOURLY"
  | "SEMI_HOURLY"
  | "MONTHLY_HOURLY"
  | "SALARIED";

function classificationFromScheduleParam(
  schedule: string | undefined,
): Classification | undefined {
  if (schedule === "monthly") return "MONTHLY_HOURLY";
  if (schedule === "semi") return "SEMI_HOURLY";
  if (schedule === "weekly") return "WEEKLY_HOURLY";
  return undefined;
}

export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams: Promise<{
    ngtecoRef?: string;
    displayName?: string;
    schedule?: string;
  }>;
}) {
  const [shifts, schedules, params, company] = await Promise.all([
    listActiveShifts(),
    listSchedules(),
    searchParams,
    getSetting("company"),
  ]);
  const tz = company?.timezone ?? "America/New_York";
  const prefillNgtecoRef = params.ngtecoRef?.slice(0, 64);
  const prefillDisplayName = params.displayName?.slice(0, 120);
  const shiftOptions: ShiftOption[] = shifts.map((s) => ({
    id: s.id,
    name: s.name,
  }));
  const scheduleOptions: ScheduleOption[] = schedules.map((s) => ({
    id: s.id,
    name: s.name,
    periodKind: s.periodKind,
    active: s.active,
  }));

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
        shifts={shiftOptions}
        schedules={scheduleOptions}
        mode="create"
        prefill={{
          ...(prefillDisplayName ? { displayName: prefillDisplayName } : {}),
          ...(prefillNgtecoRef ? { ngtecoEmployeeRef: prefillNgtecoRef } : {}),
          hiredOn: companyTodayIso(new Date(), tz),
          ...(classificationFromScheduleParam(params.schedule)
            ? {
                classification: classificationFromScheduleParam(
                  params.schedule,
                )!,
              }
            : {}),
        }}
      />
    </div>
  );
}
