// /requests is now a redirect to /calendar — pending requests merged
// into the calendar's rail so admins handle "who's out when" + "what's
// waiting on me" in one glance. The route stays so existing
// notification deeplinks ("/requests" in push payloads, bookmarks,
// search results) still resolve. The actions module + components
// (request-actions.tsx, time-off-on-behalf-form.tsx) are imported by
// /calendar so deletion would break the merger.

import { redirect } from "next/navigation";

export default function RequestsPage() {
  redirect("/calendar");
}
