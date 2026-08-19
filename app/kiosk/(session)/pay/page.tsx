import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BadgeCheck, CheckCircle2 } from "lucide-react";
import { inArray } from "drizzle-orm";
import { requireKioskEmployee } from "../../actions";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
import { formatMoney, formatHoursMinutes, addDaysIso } from "@/lib/utils";
import { listPunches } from "@/lib/db/queries/punches";
import { companyDayIso } from "@/lib/time/company-day";
import { getSetting } from "@/lib/settings/runtime";
import { localMidnightUtc } from "@/lib/utils";

import { kioskAcknowledgePayslipAction } from "../../actions";

export const dynamic = "force-dynamic";

const SHOWN = 6;

export default async function KioskPay({
  searchParams,
}: {
  searchParams: Promise<{ acked?: string }>;
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

  // Newest published payslip still waiting on the employee's OK — shown
  // front and center so it can be approved in one tap before anything else.
  const toApprove = rows.find(({ slip }) => !slip.acknowledgedAt) ?? null;

  // Day-by-day hours for the payslip awaiting approval, so the employee
  // can see exactly what they are OK-ing before tapping Approve.
  const company = await getSetting("company");
  const tz = company.timezone;
  type DayRow = { day: string; in: string; out: string | null; hours: number };
  let approveDays: DayRow[] = [];
  if (toApprove) {
    const fmtTime = (d: Date) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    // Union of period-linked and date-range punches: legacy imports can
    // sit under a sibling schedule's overlapping period id (the /time
    // grid fetches by date range for the same reason), while back-pay
    // punches carry this period's id but an out-of-range date. Both
    // belong on the card the employee is approving.
    const byPeriod = await listPunches({
      employeeId: employee.id,
      periodId: toApprove.slip.periodId,
    });
    const period = toApprove.period;
    const byRange = period
      ? await listPunches({
          employeeId: employee.id,
          clockAfter: localMidnightUtc(period.startDate, tz),
          clockBefore: new Date(
            localMidnightUtc(addDaysIso(period.endDate, 1), tz).getTime() - 1,
          ),
        })
      : [];
    const seen = new Set<string>();
    const punches = [...byPeriod, ...byRange]
      .filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
    approveDays = punches
      .filter((p) => !p.voidedAt)
      .map((p) => ({
        day: companyDayIso(p.clockIn, tz),
        in: fmtTime(p.clockIn),
        out: p.clockOut ? fmtTime(p.clockOut) : null,
        hours: p.clockOut
          ? (p.clockOut.getTime() - p.clockIn.getTime()) / 3_600_000
          : 0,
      }));
  }

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
      {sp.acked ? (
        <p className="flex items-center gap-3 rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-4 text-xl font-semibold text-brand-900">
          <CheckCircle2 className="h-7 w-7 shrink-0" /> {c.payApprovedBanner}
        </p>
      ) : null}
      {toApprove && toApprove.period ? (
        <div className="space-y-4 rounded-xl border-2 border-brand-700 bg-brand-50 px-6 py-5 shadow-card">
          <p className="flex items-center gap-2 text-lg font-bold text-brand-900">
            <BadgeCheck className="h-6 w-6 shrink-0" /> {c.payApproveTitle}
          </p>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xl font-bold text-text">
                {fmtDay(toApprove.period.startDate)} – {fmtDay(toApprove.period.endDate)}
              </p>
              <p className="text-lg text-text-muted">
                {formatHoursMinutes(Number(toApprove.slip.hoursWorked))}
              </p>
            </div>
            <p className="text-4xl font-bold tabular-nums text-text">
              {formatMoney(toApprove.slip.roundedPayCents, locale)}
            </p>
          </div>
          {approveDays.length > 0 ? (
            <div className="divide-y divide-brand-200 rounded-input border border-brand-200 bg-surface">
              {approveDays.map((r, i) => (
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
          <form action={kioskAcknowledgePayslipAction}>
            <input type="hidden" name="payslipId" value={toApprove.slip.id} />
            <button
              type="submit"
              className="h-16 w-full rounded-xl bg-brand-700 text-2xl font-bold text-white active:bg-brand-800"
            >
              {c.payApprove}
            </button>
          </form>
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
