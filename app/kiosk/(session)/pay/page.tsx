import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { inArray } from "drizzle-orm";
import { requireKioskEmployee } from "../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import { formatMoney, formatHoursMinutes } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SHOWN = 6;

export default async function KioskPay() {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const lang = (employee.language === "es" ? "es" : "en") as KioskLang;
  const c = kioskCopy(lang);
  const locale = lang === "es" ? "es-MX" : "en-US";

  const slips = await listPublishedPayslipsForEmployee(employee.id);
  const periodIds = [...new Set(slips.map((s) => s.periodId))];
  const periods = periodIds.length
    ? await db
        .select()
        .from(payPeriods)
        .where(inArray(payPeriods.id, periodIds))
    : [];
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const rows = slips
    .map((s) => ({ slip: s, period: periodById.get(s.periodId) }))
    .sort((a, b) =>
      (b.period?.startDate ?? "") < (a.period?.startDate ?? "") ? -1 : 1,
    )
    .slice(0, SHOWN);

  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T12:00:00Z`));

  return (
    <main className="flex flex-1 flex-col gap-4">
      <div>
        <Link
          href="/kiosk/home"
          className="inline-flex h-14 items-center gap-2 rounded-2xl border-2 border-neutral-300 px-5 text-xl font-semibold active:bg-neutral-100"
        >
          <ArrowLeft className="h-6 w-6" /> {c.back}
        </Link>
      </div>
      <div className="divide-y-2 divide-neutral-200 rounded-3xl border-2 border-neutral-300">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-xl text-neutral-500">
            {c.noPayslips}
          </p>
        ) : (
          rows.map(({ slip, period }) => (
            <div
              key={slip.id}
              className="flex items-center justify-between gap-3 px-6 py-5"
            >
              <div>
                <p className="text-xl font-bold">
                  {period
                    ? `${fmtDay(period.startDate)} – ${fmtDay(period.endDate)}`
                    : "—"}
                </p>
                <p className="text-lg text-neutral-600">
                  {formatHoursMinutes(Number(slip.hoursWorked))}
                </p>
              </div>
              <p className="text-2xl font-bold tabular-nums">
                {formatMoney(slip.roundedPayCents, locale)}
              </p>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
