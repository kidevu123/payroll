import { getSetting } from "@/lib/settings/runtime";
import { countPeriods } from "@/lib/db/queries/pay-periods";
import { PayPeriodForm } from "./pay-period-form";

export default async function Page() {
  const settings = await getSetting("payPeriod");
  const periodCount = await countPeriods();
  return <PayPeriodForm settings={settings} periodCount={periodCount} />;
}
