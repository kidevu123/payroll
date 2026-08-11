import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import { TimeOffForm } from "./form";

export default async function TimeOffNew() {
  const t = await getTranslations("employee.timeOff");
  const session = await requireSession();
  if (!session.user.employeeId) redirect("/me/home");
  const [employee, company] = await Promise.all([
    getEmployee(session.user.employeeId),
    getSetting("company"),
  ]);
  // Hourly employees don't accrue PTO; the form filters their type
  // dropdown accordingly. Salaried + anything else gets the full set.
  const isHourly = employee?.payType === "HOURLY";

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/me/home">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TimeOffForm
            isHourly={isHourly}
            defaultDate={companyTodayIso(new Date(), company.timezone)}
          />
        </CardContent>
      </Card>
    </main>
  );
}
