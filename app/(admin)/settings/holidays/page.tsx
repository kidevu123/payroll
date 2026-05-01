import { listAllHolidays } from "@/lib/db/queries/holidays";
import { HolidaysManager } from "./holidays-manager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await listAllHolidays();
  return <HolidaysManager holidays={rows} />;
}
