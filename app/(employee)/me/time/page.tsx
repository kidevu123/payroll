// Employee Time tab — Today (auto-refreshing) on top, then last 5 weeks
// grouped by week. The Today card picks up new punches from the NGTeco
// poll within ~1 minute (cron interval + auto-refresh).

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HoursDisplay } from "@/components/domain/hours-display";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/employee/auto-refresh";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import { listPunches } from "@/lib/db/queries/punches";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getEmployee } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { resolveLocale } from "@/lib/i18n";
import { companyDayIso } from "@/lib/time/company-day";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

// Stable ISO-style date key (YYYY-MM-DD) — locale-independent, used for
// grouping/filtering. Keep en-CA so the format never shifts.
function dayKey(d: Date, tz: string): string {
  return companyDayIso(d, tz);
}

function fmtTime(d: Date | null, tz: string, locale: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

function startOfWeek(iso: string, startDayOfWeek: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  // Back up to the most recent occurrence of the configured start day.
  // (dow - startDow + 7) % 7 = days since last <startDow>.
  const back = (dow - startDayOfWeek + 7) % 7;
  return new Date(d.getTime() - back * MS_PER_DAY).toISOString().slice(0, 10);
}

export default async function EmployeeTime() {
  const session = await requireSession();
  const t = await getTranslations("employee.time");
  const locale = await resolveLocale();
  // Format hour displays with a region-flavored locale (es-MX vs en-US).
  // The bare "es" / "en" tag is fine but es-MX is preferred for am/pm.
  const dateLocale = locale === "es" ? "es-MX" : "en-US";
  if (!session.user.employeeId) {
    return (
      <main className="px-4 py-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-text-muted mt-2">
          {t("notLinkedAccount")}
        </p>
      </main>
    );
  }
  // Salaried employees don't punch a clock — bottom-nav already hides
  // this tab, but a direct URL was rendering an empty page that
  // auto-refreshed forever. Bounce them to /me so the salaried home
  // surface (paystubs + time-off) is what they see.
  const me = await getEmployee(session.user.employeeId);
  if (me?.payType === "SALARIED") {
    redirect("/me");
  }
  const company = await getSetting("company");
  const payRules = await getSetting("payRules");
  const payPeriod = await getSetting("payPeriod");
  // Dedup once at the top so today + week views both render the same set.
  const punches = dedupNearDuplicatePunches(
    await listPunches({ employeeId: session.user.employeeId }),
  );
  const today = dayKey(new Date(), company.timezone);
  const fiveWeeksAgo = new Date(`${today}T00:00:00Z`).getTime() - 35 * MS_PER_DAY;
  const recent = punches.filter(
    (p) => p.clockIn.getTime() >= fiveWeeksAgo,
  );

  // Group: week-start-iso -> day-iso -> punches[]
  const byWeek = new Map<string, Map<string, typeof punches>>();
  for (const p of recent) {
    const day = dayKey(p.clockIn, company.timezone);
    const week = startOfWeek(day, payPeriod.startDayOfWeek);
    let weekMap = byWeek.get(week);
    if (!weekMap) {
      weekMap = new Map();
      byWeek.set(week, weekMap);
    }
    const list = weekMap.get(day) ?? [];
    list.push(p);
    weekMap.set(day, list);
  }
  const weekKeys = [...byWeek.keys()].sort().reverse();

  // Today's punches — surfaced front-and-center.
  const todayPunches = punches.filter(
    (p) => dayKey(p.clockIn, company.timezone) === today,
  );
  let todayMs = 0;
  for (const p of todayPunches) {
    if (p.voidedAt) continue;
    if (p.clockOut) todayMs += p.clockOut.getTime() - p.clockIn.getTime();
  }

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 space-y-5">
      <PageHeader
        density="employee"
        title={t("title")}
        description={t("subtitle")}
        meta={today}
        actions={<AutoRefresh intervalMs={60_000} label={t("updatesLabel")} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("todayLabel")} · {today}</CardTitle>
          <CardDescription>
            {t.rich("todaySubtitle", {
              hours: () => (
                <HoursDisplay
                  hours={todayMs / MS_PER_HOUR}
                  decimals={payRules.hoursDecimalPlaces}
                />
              ),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {todayPunches.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-text-muted leading-relaxed">
                {t("noPunchesToday")}
              </p>
              <Link
                href={`/me/time/${today}`}
                className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
              >
                {t("openDayDetail")}
              </Link>
            </div>
          ) : (
            <div className="space-y-1.5">
              {todayPunches.map((p) => (
                <div
                  key={p.id}
                  className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm rounded-input border border-border px-3 py-2 ${
                    p.voidedAt ? "opacity-50 line-through" : ""
                  }`}
                >
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
                    <span>
                      <span className="text-text-muted">{t("in")}: </span>
                      <span className="font-mono">
                        {fmtTime(p.clockIn, company.timezone, dateLocale)}
                      </span>
                    </span>
                    <span>
                      <span className="text-text-muted">{t("out")}: </span>
                      <span className="font-mono">
                        {fmtTime(p.clockOut, company.timezone, dateLocale)}
                      </span>
                    </span>
                  </span>
                  {!p.clockOut && (
                    <span className="inline-flex items-center gap-1 rounded-chip border border-success-200/80 bg-success-50 px-2 py-0.5 text-[11px] font-medium text-success-700 shrink-0">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full bg-success-700"
                      />
                      {t("onTheClock")}
                    </span>
                  )}
                </div>
              ))}
              <div className="pt-1">
                <Link
                  href={`/me/time/${today}`}
                  className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
                >
                  {t("openDayDetail")}
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {recent.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={t("noPunches")}
        />
      ) : (
        <div className="space-y-3">
          {weekKeys.map((wk) => {
            const days = byWeek.get(wk)!;
            return (
              <Card key={wk}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {t("weekOf", { date: wk })}
                  </CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-border">
                  {[...days.keys()].sort().map((d) => {
                    const list = days.get(d)!;
                    let totalMs = 0;
                    let edited = false;
                    for (const p of list) {
                      if (p.voidedAt) continue;
                      if (p.editedAt) edited = true;
                      if (p.clockOut) totalMs += p.clockOut.getTime() - p.clockIn.getTime();
                    }
                    return (
                      <Link
                        key={d}
                        href={`/me/time/${d}`}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-input text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
                      >
                        <span className="font-medium tabular-nums text-text">
                          {d}
                        </span>
                        <span className="flex items-center gap-2.5 text-xs text-text-muted">
                          {edited ? (
                            <span className="inline-flex items-center gap-1 rounded-chip border border-border/70 px-1.5 py-0.5 text-[10px] font-medium">
                              {t("edited")}
                            </span>
                          ) : null}
                          <span className="tabular-nums font-medium text-text">
                            <HoursDisplay
                              hours={totalMs / MS_PER_HOUR}
                              decimals={payRules.hoursDecimalPlaces}
                            />
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
