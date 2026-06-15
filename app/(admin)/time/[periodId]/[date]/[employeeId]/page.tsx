import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEmployee } from "@/lib/db/queries/employees";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { safeLocalReturnTo } from "@/lib/time/grid-links";
import { reconcileOrphanDayPairs } from "@/lib/punches/reconcile-orphan-day-pairs";
import { voidSupersededAmbiguousPunches } from "@/lib/punches/superseded-ambiguous";
import { mergeChainedDaySegments } from "@/lib/punches/merge-chained-day-segments";
import { PunchEditor } from "./punch-editor";

export default async function PunchEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ periodId: string; date: string; employeeId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { periodId, date, employeeId } = await params;
  const sp = await searchParams;
  const backHref = safeLocalReturnTo(
    sp.returnTo,
    `/time?${new URLSearchParams({ period: periodId })}`,
  );
  const [period, employee, company] = await Promise.all([
    getPeriodById(periodId),
    getEmployee(employeeId),
    getSetting("company"),
  ]);
  if (!period || !employee) notFound();

  await voidSupersededAmbiguousPunches(employeeId, date, company.timezone);
  await reconcileOrphanDayPairs(employeeId, date, company.timezone);
  await mergeChainedDaySegments(employeeId, date, company.timezone);
  const allPunches = await listPunches({
    periodId,
    employeeId,
    includeVoided: true,
  });

  // Sane "Add manual punch" defaults: 8 AM ET clock-in, blank clock-out.
  // Previously we passed dayStart -> dayStart+24h, which created a
  // 24-hour punch on a single submit-without-edit (the bug owner saw
  // as "25h, $5,000 for Chintu").
  const suggestedClockIn = `${date}T08:00`;
  const suggestedClockOut = "";

  // Filter punches to ones that touch this calendar day in the company
  // timezone — clock_in OR clock_out falls on the date. Without the
  // clock_out branch, an overnight punch (e.g. Sun 4 PM -> Mon 4 PM,
  // accidentally created by old buggy form defaults) was only visible
  // from the Sunday day-view, leaving admins stranded on Monday with
  // no way to void it.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  });
  const punches = allPunches.filter((p) => {
    const inDay = formatter.format(p.clockIn);
    if (inDay === date) return true;
    if (p.clockOut && formatter.format(p.clockOut) === date) return true;
    return false;
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={backHref}>
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
        periodLocked={period.state === "PAID"}
        returnTo={backHref}
      />
    </div>
  );
}
