// Employee-side fix-punch form. Only asks for the punch side that's missing.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth-guards";
import { getMissedPunchAlertById } from "@/lib/db/queries/requests";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { localMidnightUtc } from "@/lib/utils";
import {
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import { ExceptionBadge } from "@/components/domain/exception-badge";
import type { MissedPunchIssue } from "@/lib/missed-punch/claim";
import { MissedPunchForm } from "./form";

function formatWallClock(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function toDatetimeLocalValue(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function MissedPunchFixPage({
  params,
}: {
  params: Promise<{ alertId: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations("employee.missedPunch");
  if (!session.user.employeeId) notFound();
  const { alertId } = await params;
  const alert = await getMissedPunchAlertById(alertId);
  if (!alert || alert.employeeId !== session.user.employeeId) notFound();

  const company = await getSetting("company");
  const tz = company.timezone;
  const dayStart = localMidnightUtc(alert.date, tz);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const dayPunches = await listPunches({
    employeeId: alert.employeeId,
    periodId: alert.periodId,
    clockAfter: dayStart,
    clockBefore: dayEnd,
  });

  let recordedClockIn: string | null = null;
  let recordedClockOut: string | null = null;
  let defaultClockOut: string | undefined;

  for (const p of dayPunches) {
    if (isOpenShiftPunch(p)) {
      recordedClockIn = formatWallClock(p.clockIn, tz);
      const outGuess = new Date(p.clockIn.getTime() + 8 * 60 * 60 * 1000);
      defaultClockOut = toDatetimeLocalValue(outGuess, tz);
    }
    if (isMissingClockInPunch(p) && p.clockOut) {
      recordedClockOut = formatWallClock(p.clockOut, tz);
    }
  }

  return (
    <main className="px-4 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/me/home">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {alert.date} <ExceptionBadge issue={alert.issue} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MissedPunchForm
            alertId={alertId}
            date={alert.date}
            issue={alert.issue as MissedPunchIssue}
            {...(recordedClockIn ? { recordedClockIn } : {})}
            {...(recordedClockOut ? { recordedClockOut } : {})}
            {...(defaultClockOut ? { defaultClockOut } : {})}
          />
        </CardContent>
      </Card>
    </main>
  );
}
