// Money is integer cents. The only place cents become dollars is in
// formatMoney(); this component is the only React-side consumer.

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/utils";

export function MoneyDisplay({
  cents,
  className,
  // Calm pass (owner direction Jul 2026): money renders in the UI sans with
  // tabular numerals — columns still align, but figures stop reading like a
  // terminal. The prop stays so ~100 call sites don't churn; it no longer
  // switches the font.
  monospace: _monospace = true,
}: {
  cents: number;
  className?: string;
  /** Deprecated — tabular-nums provides the alignment; font stays sans. */
  monospace?: boolean;
}) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatMoney(cents)}
    </span>
  );
}
