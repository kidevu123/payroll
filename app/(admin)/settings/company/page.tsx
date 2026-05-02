import { getSetting } from "@/lib/settings/runtime";
import { CompanyForm } from "./company-form";

export default async function CompanySettingsPage() {
  const company = await getSetting("company");
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Company</h2>
      <CompanyForm initial={company} />
    </div>
  );
}
