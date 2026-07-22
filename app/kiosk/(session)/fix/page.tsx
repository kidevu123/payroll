import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AlertTriangle, CheckCircle2, ChevronRight, Hourglass, MinusCircle } from "lucide-react";
import { requireKioskEmployee } from "../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { getSetting } from "@/lib/settings/runtime";
import { listPunches } from "@/lib/db/queries/punches";
import { listPendingMissedPunchDatesForEmployee } from "@/lib/db/queries/requests";
import { companyDayIso } from "@/lib/time/company-day";
import {
  isAmbiguousSinglePunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import { formatHoursMinutes } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DAYS_BACK = 10;

export default async function KioskFixDayPicker() {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;
  const c = kioskCopy(lang);
  const locale = lang === "es" ? "es-MX" : "en-US";
  const company = await getSetting("company");
  const tz = company.timezone;

  const since = new Date(Date.now() - DAYS_BACK * 86_400_000);
  const punches = (
    await listPunches({ employeeId: employee.id, clockAfter: since })
  ).filter((p) => !p.voidedAt);
  const byDay = new Map<string, typeof punches>();
  for (const p of punches) {
    const day = companyDayIso(p.clockIn, tz);
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }

  const pendingDates = new Set(
    await listPendingMissedPunchDatesForEmployee(employee.id),
  );
  const todayIso = companyDayIso(new Date(), tz);
  const days: string[] = [];
  for (let i = 0; i < DAYS_BACK; i++) {
    days.push(companyDayIso(new Date(Date.now() - i * 86_400_000), tz));
  }

  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`));

  return (
    <main className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/kiosk/home"
          className="flex h-14 items-center gap-2 rounded-2xl border-2 border-neutral-300 px-5 text-xl font-semibold active:bg-neutral-100"
        >
          <ArrowLeft className="h-6 w-6" /> {c.back}
        </Link>
        <p className="text-lg font-medium text-neutral-500">{c.pickDay}</p>
      </div>
      <div className="divide-y-2 divide-neutral-200 rounded-3xl border-2 border-neutral-300">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const hasProblem =
            list.length === 0 ||
            list.some((p) => isAmbiguousSinglePunch(p) || isOpenShiftPunch(p));
          const totalHours = list.reduce(
            (s, p) =>
              s +
              (p.clockOut
                ? (p.clockOut.getTime() - p.clockIn.getTime()) / 3_600_000
                : 0),
            0,
          );
          const status =
            list.length === 0
              ? c.noPunches
              : list.some((p) => isAmbiguousSinglePunch(p))
                ? c.unpaired
                : list.some((p) => isOpenShiftPunch(p))
                  ? day === todayIso
                    ? c.ok
                    : c.missingOut
                  : formatHoursMinutes(totalHours);
          const problem = hasProblem && !(day === todayIso && list.length > 0);
          const inReview = pendingDates.has(day);
          return (
            <Link
              key={day}
              href={`/kiosk/fix/${day}`}
              className="flex items-center gap-4 px-6 py-5 active:bg-neutral-100"
            >
              {inReview ? (
                <Hourglass className="h-8 w-8 shrink-0 text-neutral-500" />
              ) : problem ? (
                list.length === 0 ? (
                  <MinusCircle className="h-8 w-8 shrink-0 text-neutral-400" />
                ) : (
                  <AlertTriangle className="h-8 w-8 shrink-0 text-amber-600" />
                )
              ) : (
                <CheckCircle2 className="h-8 w-8 shrink-0 text-teal-700" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-xl font-bold">
                  {day === todayIso ? c.today : fmtDay(day)}
                </span>
                <span
                  className={
                    !inReview && problem && list.length > 0
                      ? "block text-lg font-semibold text-amber-700"
                      : "block text-lg text-neutral-500"
                  }
                >
                  {inReview ? c.inReview : status}
                </span>
              </span>
              <ChevronRight className="h-7 w-7 shrink-0 text-neutral-400" />
            </Link>
          );
        })}
      </div>
    </main>
  );
}
