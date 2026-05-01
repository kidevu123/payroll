import { getSetting } from "@/lib/settings/runtime";
import { NotificationsForm } from "./notifications-form";

export const dynamic = "force-dynamic";

export default async function Page() {
  const notifications = await getSetting("notifications");
  return <NotificationsForm notifications={notifications} />;
}
