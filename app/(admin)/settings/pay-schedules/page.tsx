import {
  countEmployeesPerSchedule,
  countRunsForSchedule,
  listSchedules,
} from "@/lib/db/queries/pay-schedules";
import { PaySchedulesManager } from "./pay-schedules-manager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const schedules = await listSchedules({ includeInactive: true });
  const counts = await countEmployeesPerSchedule();
  const runCounts: Record<string, number> = {};
  await Promise.all(
    schedules.map(async (s) => {
      runCounts[s.id] = await countRunsForSchedule(s.id);
    }),
  );
  return (
    <PaySchedulesManager
      schedules={schedules}
      employeeCounts={counts}
      runCounts={runCounts}
    />
  );
}
