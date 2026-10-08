// The two states in which /time has no grid to show.
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { ScheduleTabs, type ScheduleTab } from "@/components/domain/schedule-tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Salaried staff don't punch a clock: the grid is hourly punches only. Without
 * this the Salaried tab fell through and listed every hourly employee.
 */
export function TimeSalariedEmpty({ tab }: { tab: ScheduleTab }) {
  return (
    <div className="space-y-5">
      <ScheduleTabs current={tab} basePath="/time" />
      <EmptyState
        icon={CalendarDays}
        title="Salaried staff don't punch a clock"
        description="Salaried employees are paid externally and have no time punches. Manage their paystubs and documents on the Salaried page."
      />
    </div>
  );
}

/** No pay period exists yet for the selected tab. */
export function TimeNoPeriodEmpty({ tab }: { tab: ScheduleTab }) {
  const payrollHref =
    tab === "semi"
      ? "/payroll?schedule=semi"
      : tab === "monthly"
        ? "/payroll?schedule=monthly"
        : tab === "weekly"
          ? "/payroll?schedule=weekly"
          : "/payroll";
  const clockFirst = tab === "monthly" || tab === "semi" || tab === "weekly";
  return (
    <div className="space-y-5">
      <ScheduleTabs current={tab} basePath="/time" />
      <EmptyState
        icon={CalendarDays}
        title={clockFirst ? "Waiting for clock punches" : "No pay periods yet"}
        description={
          clockFirst
            ? "Time fills from the NGTeco clock automatically — you do not need a CSV for day-to-day tracking. Make sure employees are on this pay schedule, then run Poll punches now above to sync, or add a manual punch below. CSV upload is only for one-off payroll runs."
            : "Pick a schedule tab (Weekly, Semi-monthly, or Monthly), or add a manual punch to get started."
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {clockFirst ? (
              <Button asChild>
                <Link href={payrollHref}>Go to Payroll · sync clock</Link>
              </Button>
            ) : null}
            <Button asChild variant={clockFirst ? "secondary" : "default"}>
              <Link href="/punches/new">Add manual punch</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
