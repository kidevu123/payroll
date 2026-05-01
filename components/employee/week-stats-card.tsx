// Week-stats card for the employee Home tab. Shows hours so far,
// projected net pay, and days remaining. Pure-presentational.

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";

export function WeekStatsCard({
  hours,
  projectedCents,
  daysLeft,
  decimals,
}: {
  hours: number;
  projectedCents: number;
  daysLeft: number;
  decimals: number;
}) {
  const t = useTranslations("employee.home");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("weekTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-center">
        <Stat label={t("weekHours")}>
          <HoursDisplay hours={hours} decimals={decimals} />
        </Stat>
        <Stat label={t("weekProjected")}>
          <MoneyDisplay cents={projectedCents} monospace={false} />
        </Stat>
        <Stat label={t("weekDaysLeft")}>{daysLeft}</Stat>
      </CardContent>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1">{children}</div>
    </div>
  );
}
