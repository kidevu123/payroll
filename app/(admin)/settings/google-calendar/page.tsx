// Google Calendar config page (Phase 1).
//
// What this page does today: lets the owner save the target calendar ID
// so it doesn't have to be re-entered when the OAuth + event-push
// implementation lands. Shows a setup checklist for what's still needed.
// What this page will do later: connect-with-Google flow → store sealed
// refresh token → push approved time-off events to the chosen calendar.

import { getSetting } from "@/lib/settings/runtime";
import { GoogleCalendarForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page() {
  const settings = await getSetting("googleCalendar");
  return <GoogleCalendarForm settings={settings} />;
}
