// A punch time as an admin form submits it: a bare wall-clock value is read
// in the company timezone; anything else is parsed as an instant.
import { getSetting } from "@/lib/settings/runtime";
import { isBareWallClock, wallClockToUtc } from "@/lib/time/wall-clock";

/**
 * Parse a punch-editor datetime-local string as company-timezone
 * wall-clock and return the UTC Date. Owner: "everything should be in
 * EST... there is no other time zones". Without this, the LXC's UTC
 * locale would re-interpret "2026-05-04T20:00" as 8 PM UTC instead of
 * 8 PM ET.
 */
export async function parsePunchInput(input: string): Promise<Date | null> {
  if (isBareWallClock(input)) {
    const company = await getSetting("company");
    return wallClockToUtc(input, company.timezone);
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
