// Per-alert card for the employee Home tab. Tap navigates to the
// missed-punch fix form. Polished surface with subtle hover lift and
// an explicit chevron — feels like an actionable row, not a list item.

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ExceptionBadge } from "@/components/domain/exception-badge";

export async function AlertCard({
  alertId,
  date,
  issue,
}: {
  alertId: string;
  date: string;
  issue:
    | "MISSING_IN"
    | "MISSING_OUT"
    | "UNPAIRED_PUNCH"
    | "NO_PUNCH"
    | "SUSPICIOUS_DURATION"
    | "INVERTED_TIMES";
}) {
  const t = await getTranslations("employee.alertCard");
  return (
    <Link
      href={`/me/home/missed-punch/${alertId}`}
      className="group flex items-center gap-3 rounded-input border border-border/70 bg-surface px-3 py-2.5 shadow-[0_1px_2px_0_rgb(15_23_42_/_0.03)] transition-shadow duration-200 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-page"
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-sm font-medium tracking-tight text-text antialiased">
          {date}
        </div>
        <ExceptionBadge issue={issue} />
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
        {t("fixThis")}
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
