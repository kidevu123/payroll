// Employee Home tab — week stats, alerts, quick actions.

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Wrench, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeekStatsCard } from "@/components/employee/week-stats-card";
import { AlertCard } from "@/components/employee/alert-card";
import { requireSession } from "@/lib/auth-guards";
import { listPunches } from "@/lib/db/queries/punches";
import { getEmployee } from "@/lib/db/queries/employees";
import { listRates } from "@/lib/db/queries/rate-history";
import { listAlertsForEmployee } from "@/lib/db/queries/alerts";
import { listRecentForEmployee } from "@/lib/db/queries/time-off";
import {
  ensureNextPeriod,
  getCurrentPeriod,
} from "@/lib/db/queries/pay-periods";
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
        <h1 className="text-xl font-semibold">
          {t("greeting", { name: session.user.email })}
        </h1>
        <p className="text-sm text-text-muted">
          Your account is not linked to an employee record.
        </p>
      </main>
    );
  }

  const employee = await getEmployee(session.user.employeeId);
  if (!employee) {
    return (
      <main className="px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">
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
  await ensureNextPeriod(today);
  const period = await getCurrentPeriod(today);

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
        const day = (p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn))
          .toISOString()
          .slice(0, 10);
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

  return (
    <main className="px-4 py-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">
          {t("greeting", {
            name:
              employee.displayName.split(" ")[0] ?? employee.displayName,
          })}
        </h1>
      </header>

      {!isSalaried && (
        <WeekStatsCard
          hours={stats.hours}
          projectedCents={stats.projected}
          daysLeft={stats.daysLeft}
          decimals={payRules.hoursDecimalPlaces}
        />
      )}

      {!isSalaried && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("alertsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.length === 0 ? (
              <p className="text-sm text-text-muted">{t("alertsEmpty")}</p>
            ) : (
              alerts.map((a) => (
                <AlertCard
                  key={a.id}
                  alertId={a.id}
                  date={a.date}
                  issue={a.issue}
                />
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("quickActions")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2">
          {!isSalaried && (
            <Button
              asChild
              variant="secondary"
              className="justify-start"
              disabled={alerts.length === 0}
            >
              <Link
                href={
                  alerts[0] ? `/me/home/missed-punch/${alerts[0].id}` : "#"
                }
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
        </CardContent>
      </Card>

      {isSalaried && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salaried account</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-text-muted">
            <p>
              You&apos;re on a salaried plan. Your paystubs and W2 documents
              appear under <Link href="/me/pay" className="text-brand-700 underline">Pay</Link>.
            </p>
            <p className="mt-2">
              Use the &ldquo;Request time off&rdquo; button above for vacation
              or sick days.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My time off</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentTimeOff.length === 0 ? (
            <p className="text-sm text-text-muted">
              No requests yet. Submit one with the &ldquo;Request time off&rdquo; button above.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {recentTimeOff.map((r) => {
                const status =
                  r.status === "APPROVED"
                    ? "approved"
                    : r.status === "REJECTED"
                      ? "rejected"
                      : "pending";
                const statusClass =
                  status === "approved"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : status === "rejected"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-amber-50 text-amber-700 border-amber-200";
                const typeLabel =
                  r.type === "PERSONAL"
                    ? "PTO / Vacation"
                    : r.type === "SICK"
                      ? "Sick"
                      : r.type === "UNPAID"
                        ? "Unpaid"
                        : "Other";
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-input border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {typeLabel} · {r.startDate}
                        {r.startDate !== r.endDate ? ` – ${r.endDate}` : ""}
                      </p>
                      {r.reason && (
                        <p className="text-xs text-text-muted truncate">
                          {r.reason}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-input border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusClass}`}
                    >
                      {status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
