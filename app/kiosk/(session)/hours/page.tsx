import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireKioskEmployee } from "../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { getSetting } from "@/lib/settings/runtime";
import { resolvePeriodIdForEmployeeDay } from "@/lib/db/queries/pay-periods";
import { listPunches } from "@/lib/db/queries/punches";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { companyDayIso } from "@/lib/time/company-day";
import { formatHoursMinutes } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function KioskHours() {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;
  const c = kioskCopy(lang);
  const locale = lang === "es" ? "es-MX" : "en-US";
  const company = await getSetting("company");
  const tz = company.timezone;
  const todayIso = companyDayIso(new Date(), tz);
  const periodId = await resolvePeriodIdForEmployeeDay(employee.id, todayIso);
  const [period] = periodId
    ? await db.select().from(payPeriods).where(eq(payPeriods.id, periodId))
    : [];
  const punches = periodId
    ? await listPunches({ employeeId: employee.id, periodId })
    : [];

  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`));

  type Row = { day: string; in: string; out: string | null; hours: number };
  const rows: Row[] = [];
  let totalHours = 0;
  for (const p of punches) {
    if (p.voidedAt) continue;
    const day = companyDayIso(p.clockIn, tz);
    const hours = p.clockOut
      ? (p.clockOut.getTime() - p.clockIn.getTime()) / 3_600_000
      : 0;
    totalHours += hours;
    rows.push({
      day,
      in: fmtTime(p.clockIn),
      out: p.clockOut ? fmtTime(p.clockOut) : null,
      hours,
    });
  }

  return (
    <main className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link
          href="/kiosk/home"
          className="flex h-14 items-center gap-2 rounded-xl border-2 border-border px-5 text-xl font-semibold active:bg-surface-2"
        >
          <ArrowLeft className="h-6 w-6" /> {c.back}
        </Link>
        {period ? (
          <p className="text-lg font-medium text-text-muted">
            {c.period}: {fmtDay(period.startDate)} – {fmtDay(period.endDate)}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl bg-brand-700 px-6 py-6 text-white">
        <p className="text-lg font-medium text-brand-100">{c.total}</p>
        <p className="text-5xl font-bold tabular-nums tracking-tight">
          {formatHoursMinutes(totalHours)}
        </p>
      </div>

      <div className="divide-y-2 divide-border rounded-xl border-2 border-border">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-xl text-text-muted">
            {c.noPunches}
          </p>
        ) : (
          rows.map((r, i) => (
            <div
              key={`${r.day}-${i}`}
              className="flex items-center justify-between gap-3 px-6 py-5"
            >
              <div>
                <p className="text-xl font-bold">{fmtDay(r.day)}</p>
                <p className="text-lg tabular-nums text-text-muted">
                  {r.in} – {r.out ?? c.open}
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums">
                {r.out ? formatHoursMinutes(r.hours) : "—"}
              </p>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
