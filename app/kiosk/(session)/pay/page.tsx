import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, PenLine } from "lucide-react";
import { inArray } from "drizzle-orm";
import { requireKioskEmployee } from "../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import { formatMoney, formatHoursMinutes } from "@/lib/utils";
import { loadPayslipDays } from "@/lib/kiosk/payslip-days";
import { getSetting } from "@/lib/settings/runtime";

export const dynamic = "force-dynamic";

const SHOWN = 6;

export default async function KioskPay({
  searchParams,
}: {
  searchParams: Promise<{ signed?: string }>;
}) {
  const sp = await searchParams;
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

  // The newest published payslip, when still unsigned, gets the big card.
  // Older unsigned weeks (signed on paper before the tablet existed, or a
  // missed week) stay quiet in the history list with a Sign link instead
  // of nagging forever.
  const newest = rows[0] ?? null;
  const toSign = newest && !newest.slip.signedAt ? newest : null;

  // Day-by-day hours for that payslip, so the employee can see exactly
  // what they are about to sign for.
  const company = await getSetting("company");
  const tz = company.timezone;
  const signDays = toSign
    ? await loadPayslipDays({
        employeeId: employee.id,
        periodId: toSign.slip.periodId,
        period: toSign.period,
        tz,
        locale,
      })
    : [];

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
          className="inline-flex h-14 items-center gap-2 rounded-xl border-2 border-border px-5 text-xl font-semibold active:bg-surface-2"
        >
          <ArrowLeft className="h-6 w-6" /> {c.back}
        </Link>
      </div>
      {sp.signed ? (
        <p className="flex items-center gap-3 rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-4 text-xl font-semibold text-brand-900">
          <CheckCircle2 className="h-7 w-7 shrink-0" /> {c.paySignedBanner}
        </p>
      ) : null}
      {toSign && toSign.period ? (
        <div className="space-y-4 rounded-xl border-2 border-brand-700 bg-brand-50 px-6 py-5 shadow-card">
          <p className="flex items-center gap-2 text-lg font-bold text-brand-900">
            <PenLine className="h-6 w-6 shrink-0" /> {c.payApproveTitle}
          </p>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xl font-bold text-text">
                {fmtDay(toSign.period.startDate)} – {fmtDay(toSign.period.endDate)}
              </p>
              <p className="text-lg text-text-muted">
                {formatHoursMinutes(Number(toSign.slip.hoursWorked))}
              </p>
            </div>
            <p className="text-4xl font-bold tabular-nums text-text">
              {formatMoney(toSign.slip.roundedPayCents, locale)}
            </p>
          </div>
          {signDays.length > 0 ? (
            <div className="divide-y divide-brand-200 rounded-input border border-brand-200 bg-surface">
              {signDays.map((r, i) => (
                <div
                  key={`${r.day}-${i}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <p className="text-lg font-semibold text-text">
                    {new Intl.DateTimeFormat(locale, {
                      timeZone: tz,
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    }).format(new Date(`${r.day}T12:00:00Z`))}
                  </p>
                  <p className="text-lg tabular-nums text-text-muted">
                    {r.in} – {r.out ?? c.open}
                  </p>
                  <p className="w-20 text-right text-lg font-bold tabular-nums text-text">
                    {r.out ? formatHoursMinutes(r.hours) : "—"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <Link
            href={`/kiosk/pay/sign/${toSign.slip.id}`}
            className="flex h-16 w-full items-center justify-center gap-3 rounded-xl bg-brand-700 text-2xl font-bold text-white active:bg-brand-800"
          >
            <PenLine className="h-7 w-7" /> {c.payApprove}
          </Link>
        </div>
      ) : null}
      <div className="divide-y-2 divide-border rounded-xl border-2 border-border bg-surface">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-xl text-text-muted">
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
                <p className="text-lg text-text-muted">
                  {formatHoursMinutes(Number(slip.hoursWorked))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums">
                  {formatMoney(slip.roundedPayCents, locale)}
                </p>
                {slip.signedAt ? (
                  <p className="flex items-center justify-end gap-1 text-base font-semibold text-brand-800">
                    <CheckCircle2 className="h-4 w-4" /> {c.paySignedOn}
                  </p>
                ) : (
                  <Link
                    href={`/kiosk/pay/sign/${slip.id}`}
                    className="mt-1 inline-flex h-10 items-center gap-1 rounded-input border-2 border-brand-700 px-3 text-base font-semibold text-brand-800 active:bg-brand-50"
                  >
                    <PenLine className="h-4 w-4" /> {c.paySign}
                  </Link>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
