// Week-stats card for the employee Home tab — premium polish version.
//
// One strong cue: the hours figure is the hero, sized 3xl with brand
// accent. Projected pay is secondary. Days remaining is a small chip
// in the header. A subtle progress bar against a 40h baseline gives
// visual context without the card feeling like a dashboard.
//
// Pure-presentational; the home page does the math.

import * as React from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";

const FULL_WEEK_HOURS = 40;

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
  const pct = Math.max(
    0,
    Math.min(100, Math.round((hours / FULL_WEEK_HOURS) * 100)),
  );
  return (
    <Card className="overflow-hidden">
      <CardContent className="px-6 py-5 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs uppercase tracking-wider text-text-subtle font-medium">
            {t("weekTitle")}
          </p>
          <p className="text-[11px] text-text-muted tabular-nums">
            {daysLeft === 0
              ? "Final day"
              : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] text-text-muted">{t("weekHours")}</p>
          <p className="flex items-baseline gap-1.5 text-3xl font-semibold tracking-tight tabular-nums text-text antialiased">
            <HoursDisplay
              hours={hours}
              decimals={decimals}
              className="font-sans"
            />
            <span className="text-base font-medium text-text-subtle">hrs</span>
          </p>
        </div>

        {/* Subtle progress against a 40h baseline. Caps at 100% and
            uses the brand accent so the bar feels like part of the
            same surface, not a separate component. */}
        <div className="space-y-1.5">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={FULL_WEEK_HOURS}
            aria-valuenow={Math.min(hours, FULL_WEEK_HOURS)}
            aria-label="Hours this week against 40-hour baseline"
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className="h-full rounded-full bg-brand-700 transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span>{t("weekProjected")}</span>
            <span className="tabular-nums font-medium text-text">
              <MoneyDisplay cents={projectedCents} monospace={false} />
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
