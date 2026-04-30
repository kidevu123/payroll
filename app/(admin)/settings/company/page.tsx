import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getSetting } from "@/lib/settings/runtime";
import { CompanyForm } from "./company-form";

export default async function CompanySettingsPage() {
  const company = await getSetting("company");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Company</CardTitle>
        <CardDescription>
          Name, address, brand color, and locale. The brand color cascades to PDFs and the UI.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CompanyForm initial={company} />
      </CardContent>
    </Card>
  );
}
