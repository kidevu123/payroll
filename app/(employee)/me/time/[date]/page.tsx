// Employee day-detail screen. Shows the day's punches with in/out/hours
// and an "edited" indicator. Phase 5 will add the missed-punch fix CTA.

import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoursDisplay } from "@/components/domain/hours-display";
import { requireSession } from "@/lib/auth-guards";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";

const MS_PER_HOUR = 60 * 60 * 1000;

function fmtTime(d: Date | null, tz: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

export default async function EmployeeDay({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations("employee.time");
  if (!session.user.employeeId) return <main className="p-4">…</main>;
  const { date } = await params;
  const company = await getSetting("company");
  const payRules = await getSetting("payRules");
  const punches = await listPunches({ employeeId: session.user.employeeId });
  const dayPunches = punches.filter(
    (p) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: company.timezone }).format(p.clockIn) === date,
  );

  let totalMs = 0;
  for (const p of dayPunches) {
    if (p.voidedAt) continue;
    if (p.clockOut) totalMs += p.clockOut.getTime() - p.clockIn.getTime();
  }

  return (
    <main className="px-4 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/me/time">
          <ArrowLeft className="h-4 w-4" /> {t("title")}
        </Link>
      </Button>
      <h1 className="text-xl font-semibold">{date}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <HoursDisplay
              hours={totalMs / MS_PER_HOUR}
              decimals={payRules.hoursDecimalPlaces}
            />{" "}
            {t("hours").toLowerCase()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dayPunches.length === 0 ? (
            <p className="text-sm text-text-muted">{t("noPunches")}</p>
          ) : (
            dayPunches.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between text-sm rounded-input border border-border px-3 py-2 ${
                  p.voidedAt ? "opacity-50 line-through" : ""
                }`}
              >
                <span>
                  <span className="text-text-muted">{t("in")}: </span>
                  <span className="font-mono">{fmtTime(p.clockIn, company.timezone)}</span>
                  <span className="text-text-muted ml-3">{t("out")}: </span>
                  <span className="font-mono">{fmtTime(p.clockOut, company.timezone)}</span>
                </span>
                {p.editedAt ? (
                  <span className="flex items-center gap-1 text-xs text-text-muted">
                    <Pencil className="h-3 w-3" /> {t("edited")}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
