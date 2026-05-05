// Employee Home tab — premium owner-pulse landing.
//
// Layout (mobile-first, single column):
//   1. Greeting header
//   2. Week stats (hours hero + progress + projected pay) — hourly only
//   3. Latest payslip preview card — clickable
//   4. Requests card — open missed-punch alerts + recent time-off summary
//   5. Quick actions row
//
// Salaried employees skip the week-stats + alerts cards. Their pay
// surface is uploaded paystubs only; we keep the latest-payslip card
// out of their view as well since hourly payslips don't apply.

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Wrench,
  CalendarPlus,
  ChevronRight,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeekStatsCard } from "@/components/employee/week-stats-card";
import { AlertCard } from "@/components/employee/alert-card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { StatusPill } from "@/components/domain/status-pill";
import { requireSession } from "@/lib/auth-guards";
import { listPunches } from "@/lib/db/queries/punches";
import { getEmployee } from "@/lib/db/queries/employees";
import { listRates } from "@/lib/db/queries/rate-history";
import { listAlertsForEmployee } from "@/lib/db/queries/alerts";
import { listRecentForEmployee } from "@/lib/db/queries/time-off";
import {
  getCurrentPeriod,
  getCurrentPeriodForSchedule,
  getPeriodById,
} from "@/lib/db/queries/pay-periods";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function todayInTz(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export default async function EmployeeHome() {
  const session = await requireSession();
  const t = await getTranslations("employee.home");
  if (!session.user.employeeId) {
    return (
      <main className="px-4 py-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight antialiased">
          {t("greeting", { name: session.user.email })}
        </h1>
        <p className="text-sm text-text-muted leading-relaxed">
          {t("notLinkedAccount")}
        </p>
      </main>
    );
  }

  const employee = await getEmployee(session.user.employeeId);
  if (!employee) {
    return (
      <main className="px-4 py-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight antialiased">
          {t("greeting", { name: session.user.email })}
        </h1>
      </main>
    );
  }

  const isSalaried = employee.payType === "SALARIED";

  const [company, payRules] = await Promise.all([
    getSetting("company"),
    getSetting("payRules"),
  ]);
  const today = todayInTz(company.timezone);
  // Pick the period that matches THIS employee's pay schedule. A weekly
  // employee on May 5 should see the May 4-10 weekly period, not the
  // overlapping May 1-15 semi-monthly one. Falls back to the generic
  // by-date lookup only when the employee has no schedule assigned.
  const period = employee.payScheduleId
    ? await getCurrentPeriodForSchedule({
        today,
        payScheduleId: employee.payScheduleId,
      })
    : await getCurrentPeriod(today);

  // Recent time-off request history for this employee — visible to all
  // classifications (salaried + hourly all submit requests).
  const recentTimeOff = await listRecentForEmployee(employee.id, 5);

  let stats = { hours: 0, projected: 0, daysLeft: 0 };
  let alerts: Awaited<ReturnType<typeof listAlertsForEmployee>> = [];
  if (period && !isSalaried) {
    const [punches, rates, openAlerts] = await Promise.all([
      listPunches({ periodId: period.id, employeeId: employee.id }),
      listRates(employee.id),
      listAlertsForEmployee(employee.id, { unresolvedOnly: true }),
    ]);
    alerts = openAlerts;
    const result = computePay({
      punches,
      rateAt: (p) => {
        // Resolve the punch day in COMPANY TZ (not UTC) — a 22:00 ET punch
        // shifts to next-day in UTC and silently grabs a next-day rate. Mirrors
        // the publish handler + period detail page (lib/pdf/build-admin-report.ts).
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: company.timezone,
        }).format(
          p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn),
        );
        for (const r of rates) if (r.effectiveFrom <= day) return r.hourlyRateCents;
        return employee.hourlyRateCents ?? 0;
      },
      taskPay: [],
      rules: {
        rounding: payRules.rounding,
        hoursDecimalPlaces: payRules.hoursDecimalPlaces,
      },
    });
    const todayMs = new Date(`${today}T00:00:00Z`).getTime();
    const endMs = new Date(`${period.endDate}T00:00:00Z`).getTime();
    stats = {
      hours: result.totalHours,
      projected: result.roundedCents,
      daysLeft: Math.max(0, Math.round((endMs - todayMs) / MS_PER_DAY)),
    };
  }

  // Latest published payslip — preview card. Skipped for salaried since
  // their pay flow is uploaded paystubs (no punch-driven payslips).
  let latestPayslip: {
    id: string;
    periodId: string;
    periodStart: string;
    periodEnd: string;
    hours: number;
    netCents: number;
    state: "acknowledged" | "published" | "disputed";
  } | null = null;
  if (!isSalaried) {
    const all = await listPublishedPayslipsForEmployee(employee.id);
    if (all.length > 0) {
      // Need the period to render dates — fetch the most recent one. Sort
      // by generatedAt desc to find the latest, then resolve its period.
      const sorted = [...all].sort((a, b) => {
        const at = a.generatedAt instanceof Date ? a.generatedAt.getTime() : 0;
        const bt = b.generatedAt instanceof Date ? b.generatedAt.getTime() : 0;
        return bt - at;
      });
      const top = sorted[0]!;
      const topPeriod = await getPeriodById(top.periodId);
      if (topPeriod) {
        latestPayslip = {
          id: top.id,
          periodId: top.periodId,
          periodStart: topPeriod.startDate,
          periodEnd: topPeriod.endDate,
          hours: Number(top.hoursWorked),
          netCents: top.roundedPayCents,
          state:
            top.disputedAt && !top.disputeResolvedAt
              ? "disputed"
              : top.acknowledgedAt
                ? "acknowledged"
                : "published",
        };
      }
    }
  }

  const firstName =
    employee.displayName.split(" ")[0] ?? employee.displayName;

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight antialiased">
          {t("greeting", { name: firstName })}
        </h1>
        <p className="text-sm text-text-muted leading-relaxed">
          {today}
        </p>
      </header>

      {!isSalaried && (
        <WeekStatsCard
          hours={stats.hours}
          projectedCents={stats.projected}
          daysLeft={stats.daysLeft}
          decimals={payRules.hoursDecimalPlaces}
        />
      )}

      {!isSalaried && latestPayslip && (
        <Link
          href={`/me/pay/${latestPayslip.periodId}`}
          className="group block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          <Card className="transition-shadow duration-200 hover:shadow-card-hover">
            <CardContent className="px-6 py-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wider text-text-subtle font-medium">
                  {t("latestPayslip")}
                </p>
                {latestPayslip.state === "disputed" ? (
                  <span className="inline-flex items-center gap-1 rounded-chip border border-warn-200/80 bg-warn-50 px-2 py-0.5 text-[11px] font-medium tracking-tight text-warn-700">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {t("reported")}
                  </span>
                ) : latestPayslip.state === "acknowledged" ? (
                  <StatusPill status="APPROVED" />
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-chip border border-info-200/80 bg-info-50 px-2 py-0.5 text-[11px] font-medium tracking-tight text-info-700">
                    {t("awaitingReview")}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium tracking-tight text-text antialiased">
                  {latestPayslip.periodStart}{" "}
                  <span className="text-text-subtle">–</span>{" "}
                  {latestPayslip.periodEnd}
                </p>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-3xl font-semibold tracking-tight tabular-nums text-text">
                    <MoneyDisplay
                      cents={latestPayslip.netCents}
                      monospace={false}
                    />
                  </p>
                  <p className="text-xs text-text-muted">
                    <HoursDisplay
                      hours={latestPayslip.hours}
                      decimals={payRules.hoursDecimalPlaces}
                    />{" "}
                    <span className="text-text-subtle">{t("hrsAbbr")}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs font-medium text-brand-700">
                {t("openPayslip")}
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Requests card — combines open alerts + recent time-off into a
          single "what needs your attention" surface. */}
      <Card>
        <CardHeader>
          <CardTitle>{t("requestsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSalaried && (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[11px] uppercase tracking-wider font-medium text-text-subtle">
                  {t("alertsTitle")}
                </h3>
                {alerts.length > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn-50 border border-warn-200/80 px-1.5 text-[10px] font-medium text-warn-700 tabular-nums">
                    {alerts.length}
                  </span>
                )}
              </div>
              {alerts.length === 0 ? (
                <p className="text-sm text-text-muted leading-relaxed">
                  {t("alertsEmpty")}
                </p>
              ) : (
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <AlertCard
                      key={a.id}
                      alertId={a.id}
                      date={a.date}
                      issue={a.issue}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] uppercase tracking-wider font-medium text-text-subtle">
                {t("timeOff")}
              </h3>
              <Link
                href="/me/home/time-off/new"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-800"
              >
                {t("newRequest")}
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {recentTimeOff.length === 0 ? (
              <p className="text-sm text-text-muted leading-relaxed">
                {t("noTimeOffRequests")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {recentTimeOff.map((r) => {
                  const status =
                    r.status === "APPROVED"
                      ? "APPROVED"
                      : r.status === "REJECTED"
                        ? "REJECTED"
                        : "PENDING";
                  const typeLabel =
                    r.type === "PERSONAL"
                      ? t("ptoVacation")
                      : r.type === "SICK"
                        ? t("sick")
                        : r.type === "UNPAID"
                          ? t("unpaid")
                          : t("other");
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-input border border-border/70 bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium tracking-tight text-text antialiased truncate">
                          {typeLabel}
                        </p>
                        <p className="text-[11px] text-text-muted tabular-nums">
                          {r.startDate}
                          {r.startDate !== r.endDate ? ` – ${r.endDate}` : ""}
                        </p>
                      </div>
                      <StatusPill status={status} className="shrink-0" />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>

      {/* Quick actions footer — secondary surface so it doesn't compete
          with the requests card above. */}
      <div className="grid grid-cols-1 gap-2">
        {!isSalaried && (
          <Button
            asChild
            variant="secondary"
            className="justify-start"
            disabled={alerts.length === 0}
          >
            <Link
              href={alerts[0] ? `/me/home/missed-punch/${alerts[0].id}` : "#"}
            >
              <Wrench className="h-4 w-4" /> {t("fixMissedPunch")}
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary" className="justify-start">
          <Link href="/me/home/time-off/new">
            <CalendarPlus className="h-4 w-4" /> {t("requestTimeOff")}
          </Link>
        </Button>
      </div>

      {isSalaried && (
        <Card>
          <CardHeader>
            <CardTitle>{t("salariedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-text-muted leading-relaxed space-y-2">
            <p>
              {t.rich("salariedBody1", {
                payLink: (chunks) => (
                  <Link
                    href="/me/pay"
                    className="text-brand-700 font-medium hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            <p>{t("salariedBody2")}</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
