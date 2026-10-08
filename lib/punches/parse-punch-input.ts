// A punch time as an admin form submits it: a bare wall-clock value is read
// in the company timezone; anything else is parsed as an instant.
import { getSetting } from "@/lib/settings/runtime";
import { isBareWallClock, wallClockToUtc } from "@/lib/time/wall-clock";

export async function parsePunchInput(input: string): Promise<Date | null> {
  if (isBareWallClock(input)) {
    const company = await getSetting("company");
    return wallClockToUtc(input, company.timezone);
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
