import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Hourglass } from "lucide-react";
import { requireKioskEmployee } from "../../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { getSetting } from "@/lib/settings/runtime";
import { listPunches } from "@/lib/db/queries/punches";
import { listPendingMissedPunchDatesForEmployee } from "@/lib/db/queries/requests";
import { companyDayIso } from "@/lib/time/company-day";
import { buildEmployeeReportFixMode } from "@/lib/missed-punch/employee-report-mode";
import { KioskFixForm } from "./fix-form";

export const dynamic = "force-dynamic";

export default async function KioskFixDay({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;
  const c = kioskCopy(lang);
  const locale = lang === "es" ? "es-MX" : "en-US";
  const company = await getSetting("company");
  const tz = company.timezone;

  const pendingDates = await listPendingMissedPunchDatesForEmployee(
    employee.id,
  );
  const alreadyReported = pendingDates.includes(date);
  const punches = (await listPunches({ employeeId: employee.id })).filter(
    (p) => !p.voidedAt && companyDayIso(p.clockIn, tz) === date,
  );
  const mode = buildEmployeeReportFixMode({ date, timezone: tz, punches });

  const dayLabel = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <main className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/kiosk/fix"
          className="flex h-14 items-center gap-2 rounded-xl border-2 border-border px-5 text-xl font-semibold active:bg-surface-2"
        >
          <ArrowLeft className="h-6 w-6" /> {c.back}
        </Link>
        <p className="text-xl font-bold">{dayLabel}</p>
      </div>
      {alreadyReported ? (
        <p className="flex items-center gap-3 rounded-xl border-2 border-border bg-surface-2 px-5 py-6 text-xl font-semibold text-text">
          <Hourglass className="h-8 w-8 shrink-0" /> {c.inReview}
        </p>
      ) : (
        <KioskFixForm date={date} mode={mode} copy={c} />
      )}
    </main>
  );
}
