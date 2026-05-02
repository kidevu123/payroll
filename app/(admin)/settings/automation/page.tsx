import { getSetting } from "@/lib/settings/runtime";
import { AutomationForm } from "./automation-form";
import { ClearCronButton } from "./clear-cron-button";

export const dynamic = "force-dynamic";

export default async function Page() {
  const automation = await getSetting("automation");
  return (
    <div className="space-y-4">
      <AutomationForm automation={automation} />
      {automation.cronEnabled ? (
        <ClearCronButton disabledReason="Turn off the cron master switch above and save first." />
      ) : (
        <ClearCronButton />
      )}
    </div>
  );
}
