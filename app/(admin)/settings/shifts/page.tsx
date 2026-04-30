import { listShifts } from "@/lib/db/queries/shifts";
import { ShiftsManager } from "./shifts-manager";

export default async function Page() {
  const shifts = await listShifts({ includeArchived: true });
  return <ShiftsManager shifts={shifts} />;
}
