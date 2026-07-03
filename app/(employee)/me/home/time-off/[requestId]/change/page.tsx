import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { getTimeOffRequest } from "@/lib/db/queries/time-off";
import { getSetting } from "@/lib/settings/runtime";
import { companyTodayIso } from "@/lib/time/company-day";
import { isEmployeeEditableTimeOff } from "@/lib/time-off/change-request";
import { ChangeTimeOffForm } from "./form";

export default async function ChangeTimeOffPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const t = await getTranslations("employee.timeOff");
  const session = await requireSession();
  if (!session.user.employeeId) redirect("/me/home");
  const { requestId } = await params;
  const [request, employee, company] = await Promise.all([
    getTimeOffRequest(requestId),
    getEmployee(session.user.employeeId),
    getSetting("company"),
  ]);
  if (!request || request.employeeId !== session.user.employeeId) notFound();
  if (
    request.type === "SCHEDULE_NOTE" ||
    !isEmployeeEditableTimeOff(request, companyTodayIso(new Date(), company.timezone))
  ) {
    redirect("/me/home");
  }

  return (
    <main className="space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/me/home">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("changeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-muted">{t("changeApprovalHint")}</p>
          <ChangeTimeOffForm
            requestId={request.id}
            isHourly={employee?.payType === "HOURLY"}
            initial={{
              startDate: request.startDate,
              endDate: request.endDate,
              type: request.type as "UNPAID" | "SICK" | "PERSONAL" | "OTHER",
              reason: request.reason ?? "",
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
