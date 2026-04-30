// Hours render in tabular numerals. The decimal-places setting flows through
// from `payRules.hoursDecimalPlaces` — caller passes the resolved value.

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/utils";

export function HoursDisplay({
  hours,
  decimals = 2,
  className,
}: {
  hours: number;
  decimals?: number;
  className?: string;
}) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {formatHours(hours, decimals)}
    </span>
  );
}
