// The signing screen: period, hours, day rows and pay for ONE payslip,
// followed by the signature pad. Shared by /kiosk/pay/sign (self-serve,
// employee PIN session) and /kiosk/payday/sign (owner-driven session).
// This screen only ever renders the one payslip it was given — the
// privacy contract of the whole feature lives here.

import Link from "next/link";
import { ArrowLeft, PenLine } from "lucide-react";
import type { Payslip } from "@/lib/db/schema";
import { kioskCopy, type KioskLang } from "@/lib/kiosk/copy";
import { loadPayslipDays } from "@/lib/kiosk/payslip-days";
import { getSetting } from "@/lib/settings/runtime";
import { formatHoursMinutes, formatMoney } from "@/lib/utils";
import { PayslipSignForm, type SignActionResult } from "./sign-form";

export async function PayslipSignScreen({
  lang,
  employeeName,
  slip,
  period,
  action,
  backHref,
}: {
  lang: KioskLang;
  /** Shown in payday mode so the owner can confirm who is holding the tablet. */
  employeeName?: string;
  slip: Payslip;
  period: { startDate: string; endDate: string };
  action: (formData: FormData) => Promise<SignActionResult>;
  backHref: string;
}) {
  const c = kioskCopy(lang);
  const locale = lang === "es" ? "es-MX" : "en-US";
  const company = await getSetting("company");
  const tz = company.timezone;
  const days = await loadPayslipDays({
    employeeId: slip.employeeId,
    periodId: slip.periodId,
    period,
    tz,
    locale,
  });
  const fmtDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T12:00:00Z`));
  const fmtWeekday = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${iso}T12:00:00Z`));

  return (
    <main className="flex flex-1 flex-col gap-4">
      <div>
        <Link
          href={backHref}
          className="inline-flex h-14 items-center gap-2 rounded-xl border-2 border-border px-5 text-xl font-semibold active:bg-surface-2"
        >
          <ArrowLeft className="h-6 w-6" /> {c.back}
        </Link>
      </div>
      <div className="space-y-4 rounded-xl border-2 border-brand-700 bg-brand-50 px-6 py-5 shadow-card">
        <p className="flex items-center gap-2 text-lg font-bold text-brand-900">
          <PenLine className="h-6 w-6 shrink-0" /> {c.paySignTitle}
        </p>
        {employeeName ? (
          <p className="text-3xl font-bold tracking-tight text-text">{employeeName}</p>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xl font-bold text-text">
              {fmtDay(period.startDate)} – {fmtDay(period.endDate)}
            </p>
            <p className="text-lg text-text-muted">
              {formatHoursMinutes(Number(slip.hoursWorked))}
            </p>
          </div>
          <p className="text-4xl font-bold tabular-nums text-text">
            {formatMoney(slip.roundedPayCents, locale)}
          </p>
        </div>
        {days.length > 0 ? (
          <div className="divide-y divide-brand-200 rounded-input border border-brand-200 bg-surface">
            {days.map((r, i) => (
              <div
                key={`${r.day}-${i}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <p className="text-lg font-semibold text-text">{fmtWeekday(r.day)}</p>
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
        <PayslipSignForm
          payslipId={slip.id}
          action={action}
          copy={{
            statement: c.paySignStatement,
            hint: c.paySignHint,
            clear: c.paySignClear,
            sign: c.paySign,
            signing: c.paySigning,
          }}
        />
      </div>
    </main>
  );
}
