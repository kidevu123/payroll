import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEmployee } from "@/lib/db/queries/employees";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { PunchEditor } from "./punch-editor";

export default async function PunchEditorPage({
  params,
}: {
  params: Promise<{ periodId: string; date: string; employeeId: string }>;
}) {
  const { periodId, date, employeeId } = await params;
  const [period, employee, allPunches, company] = await Promise.all([
    getPeriodById(periodId),
    getEmployee(employeeId),
    listPunches({ periodId, employeeId, includeVoided: true }),
    getSetting("company"),
  ]);
  if (!period || !employee) notFound();

  // Sane "Add manual punch" defaults: 8 AM ET clock-in, blank clock-out.
  // Previously we passed dayStart -> dayStart+24h, which created a
  // 24-hour punch on a single submit-without-edit (the bug owner saw
  // as "25h, $5,000 for Chintu").
  const suggestedClockIn = `${date}T08:00`;
  const suggestedClockOut = "";

  // Filter punches to ones whose clockIn falls on this calendar day in
  // the company timezone.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  });
  const punches = allPunches.filter(
    (p) => formatter.format(p.clockIn) === date,
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/time">
          <ArrowLeft className="h-4 w-4" /> Back to grid
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold">{employee.displayName}</h1>
        <p className="text-sm text-text-muted">
          {date} · period {period.startDate} – {period.endDate}
        </p>
      </div>
      <PunchEditor
        periodId={periodId}
        employeeId={employeeId}
        date={date}
        timezone={company.timezone}
        punches={punches}
        suggestedClockIn={suggestedClockIn}
        suggestedClockOut={suggestedClockOut}
        periodLocked={period.state !== "OPEN"}
      />
    </div>
  );
}
