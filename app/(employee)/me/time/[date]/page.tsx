// Employee day-detail screen. Shows the day's punches with in/out/hours,
// an "edited" indicator, and a "Report a fix" form that creates a
// missed-punch request without needing a pre-existing alert.

import Link from "next/link";
import { ArrowLeft, Pencil, CheckCircle2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoursDisplay } from "@/components/domain/hours-display";
import { requireSession } from "@/lib/auth-guards";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { ReportFixForm } from "./report-form";

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
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ reported?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations("employee.time");
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
  // Pre-fill the report form with the first punch if one exists.
  const firstPunch = dayPunches[0];
  const fmtForInput = (d: Date | null): string => {
    if (!d) return "";
    return `${date}T${new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: company.timezone,
      hourCycle: "h23",
    }).format(d)}`;
  };

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

      {sp.reported && (
        <div className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Sent. Admin will review on /requests.
        </div>
      )}

      <ReportFixForm
        date={date}
        defaultIn={fmtForInput(firstPunch?.clockIn ?? null)}
        defaultOut={fmtForInput(firstPunch?.clockOut ?? null)}
      />
    </main>
  );
}
