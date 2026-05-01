import { getSetting } from "@/lib/settings/runtime";
import { AutomationForm } from "./automation-form";

export const dynamic = "force-dynamic";

export default async function Page() {
  const automation = await getSetting("automation");
  return <AutomationForm automation={automation} />;
}
