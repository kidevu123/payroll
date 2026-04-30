import { getSetting } from "@/lib/settings/runtime";
import { PayRulesForm } from "./pay-rules-form";

export default async function Page() {
  const settings = await getSetting("payRules");
  return <PayRulesForm settings={settings} />;
}
