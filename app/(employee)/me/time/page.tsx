// Employee Time tab — Today (auto-refreshing) on top, then last 5 weeks
// grouped by week. The Today card picks up new punches from the NGTeco
// poll within ~1 minute (cron interval + auto-refresh).

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HoursDisplay } from "@/components/domain/hours-display";
import { AutoRefresh } from "@/components/employee/auto-refresh";
import { requireSession } from "@/lib/auth-guards";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

function fmtTime(d: Date | null, tz: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = (dow + 6) % 7; // back to Monday
  return new Date(d.getTime() - back * MS_PER_DAY).toISOString().slice(0, 10);
}

export default async function EmployeeTime() {
  const session = await requireSession();
  const t = await getTranslations("employee.time");
  if (!session.user.employeeId) {
    return (
      <main className="px-4 py-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-text-muted mt-2">
          Account not linked to an employee.
        </p>
      </main>
    );
  }
  const company = await getSetting("company");
  const payRules = await getSetting("payRules");
  const punches = await listPunches({ employeeId: session.user.employeeId });
  const today = dayKey(new Date(), company.timezone);
  const fiveWeeksAgo = new Date(`${today}T00:00:00Z`).getTime() - 35 * MS_PER_DAY;
  const recent = punches.filter(
    (p) => p.clockIn.getTime() >= fiveWeeksAgo,
  );

  // Group: week-start-iso -> day-iso -> punches[]
  const byWeek = new Map<string, Map<string, typeof punches>>();
  for (const p of recent) {
    const day = dayKey(p.clockIn, company.timezone);
    const week = startOfWeek(day);
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
    <main className="px-4 py-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-text-muted">{t("subtitle")}</p>
        </div>
        <AutoRefresh intervalMs={60_000} label="Updates" />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today · {today}</CardTitle>
          <CardDescription>
            <HoursDisplay
              hours={todayMs / MS_PER_HOUR}
              decimals={payRules.hoursDecimalPlaces}
            />{" "}
            so far. Pulled from NGTeco every few minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {todayPunches.length === 0 ? (
            <p className="text-sm text-text-muted">
              No punches yet today. They&apos;ll appear here within a minute
              of you clocking in.
            </p>
          ) : (
            <div className="space-y-1.5">
              {todayPunches.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between text-sm rounded-input border border-border px-3 py-2 ${
                    p.voidedAt ? "opacity-50 line-through" : ""
                  }`}
                >
                  <span>
                    <span className="text-text-muted">{t("in")}: </span>
                    <span className="font-mono">
                      {fmtTime(p.clockIn, company.timezone)}
                    </span>
                    <span className="text-text-muted ml-3">{t("out")}: </span>
                    <span className="font-mono">
                      {fmtTime(p.clockOut, company.timezone)}
                    </span>
                  </span>
                  {!p.clockOut && (
                    <span className="text-xs text-emerald-700 font-medium">on the clock</span>
                  )}
                </div>
              ))}
              <div className="pt-2">
                <Link
                  href={`/me/time/${today}`}
                  className="text-xs text-brand-700 hover:underline"
                >
                  Open day detail · report a fix →
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
          description=""
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
                        className="flex items-center justify-between py-2 text-sm hover:bg-surface-2 -mx-2 px-2 rounded"
                      >
                        <span className="font-medium">{d}</span>
                        <span className="flex items-center gap-3 text-xs text-text-muted">
                          {edited ? <span>{t("edited")}</span> : null}
                          <HoursDisplay
                            hours={totalMs / MS_PER_HOUR}
                            decimals={payRules.hoursDecimalPlaces}
                          />
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

