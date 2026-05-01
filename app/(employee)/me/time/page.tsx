// Employee Time tab — last 5 weeks of punches grouped by week.

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HoursDisplay } from "@/components/domain/hours-display";
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

  return (
    <main className="px-4 py-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-text-muted">{t("subtitle")}</p>
      </header>

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

// Mark unused for now to avoid lint warning.
void fmtTime;
