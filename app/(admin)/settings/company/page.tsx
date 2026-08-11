import { getSetting } from "@/lib/settings/runtime";
import { CompanyForm } from "./company-form";

export default async function CompanySettingsPage() {
  const company = await getSetting("company");
  return (
    <div className="space-y-5">
      <h2 className="text-heading font-semibold tracking-tight text-text">Company</h2>
      <CompanyForm initial={company} />
    </div>
  );
}
