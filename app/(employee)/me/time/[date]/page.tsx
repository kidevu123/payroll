// Employee day-detail screen. Shows the day's punches with in/out/hours,
// an "edited" indicator, and a "Report a fix" form that creates a
// missed-punch request without needing a pre-existing alert.

import Link from "next/link";
import { ArrowLeft, Pencil, CircleCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { HoursDisplay } from "@/components/domain/hours-display";
import { requireSession } from "@/lib/auth-guards";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { resolveLocale } from "@/lib/i18n";
import { ReportFixForm } from "./report-form";
import { buildEmployeeReportFixMode } from "@/lib/missed-punch/employee-report-mode";

const MS_PER_HOUR = 60 * 60 * 1000;

function fmtTime(d: Date | null, tz: string, locale: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

export default async function EmployeeDay({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ reported?: string }>;
}) {
  const session = await requireSession();
  const [t, tDay, locale] = await Promise.all([
    getTranslations("employee.time"),
    getTranslations("employee.day"),
    resolveLocale(),
  ]);
  const dateLocale = locale === "es" ? "es-MX" : "en-US";
  if (!session.user.employeeId) return <main className="p-4">…</main>;
  const { date } = await params;
  const sp = await searchParams;
  const company = await getSetting("company");
  const payRules = await getSetting("payRules");
  const punches = await listPunches({ employeeId: session.user.employeeId });
  const dayPunches = punches.filter(
    (p) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: company.timezone }).format(p.clockIn) === date,
  );
  const reportMode = buildEmployeeReportFixMode({
    date,
    timezone: company.timezone,
    punches: dayPunches,
  });

  let totalMs = 0;
  for (const p of dayPunches) {
    if (p.voidedAt) continue;
    if (p.clockOut) totalMs += p.clockOut.getTime() - p.clockIn.getTime();
  }

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/me/time">
          <ArrowLeft className="h-4 w-4" /> {t("title")}
        </Link>
      </Button>
      <PageHeader
        density="employee"
        title={date}
        meta={
          <span className="inline-flex items-baseline gap-1">
            <HoursDisplay
              hours={totalMs / MS_PER_HOUR}
              decimals={payRules.hoursDecimalPlaces}
            />{" "}
            {t("hours").toLowerCase()}
          </span>
        }
      />

      {sp.reported && (
        <div className="flex items-start gap-2 rounded-card border border-success-200/80 bg-success-50 px-3.5 py-3 text-sm font-medium text-success-700">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{tDay("reportSent")}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dayPunches.length === 0 ? (
            <p className="text-sm text-text-muted leading-relaxed">
              {t("noPunches")}
            </p>
          ) : (
            dayPunches.map((p) => (
              <div
                key={p.id}
                className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-input border border-border px-3 py-2.5 text-sm ${
                  p.voidedAt ? "opacity-50 line-through" : ""
                }`}
              >
                <span className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                  <span>
                    <span className="text-text-muted">{t("in")}: </span>
                    <span className="font-mono tabular-nums">
                      {fmtTime(p.clockIn, company.timezone, dateLocale)}
                    </span>
                  </span>
                  <span>
                    <span className="text-text-muted">{t("out")}: </span>
                    <span className="font-mono tabular-nums">
                      {fmtTime(p.clockOut, company.timezone, dateLocale)}
                    </span>
                  </span>
                </span>
                {p.editedAt ? (
                  <span className="flex items-center gap-1 text-xs text-text-muted shrink-0">
                    <Pencil className="h-3 w-3" /> {t("edited")}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <ReportFixForm date={date} mode={reportMode} />
    </main>
  );
}
