// Money is integer cents. The only place cents become dollars is in
// formatMoney(); this component is the only React-side consumer.

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/utils";

export function MoneyDisplay({
  cents,
  className,
  monospace = true,
}: {
  cents: number;
  className?: string;
  monospace?: boolean;
}) {
  return (
    <span
      className={cn(
        "tabular-nums",
        monospace && "font-mono",
        className,
      )}
    >
      {formatMoney(cents)}
    </span>
  );
}
