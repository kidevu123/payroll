// Per-alert card for the employee Home tab. Phase 5 will replace the
// "Coming in Phase 5" hint with a real /home/missed-punch/[alertId] form.

import * as React from "react";
import { ExceptionBadge } from "@/components/domain/exception-badge";
import { useTranslations } from "next-intl";

export function AlertCard({
  date,
  issue,
}: {
  date: string;
  issue: "MISSING_IN" | "MISSING_OUT" | "NO_PUNCH" | "SUSPICIOUS_DURATION";
}) {
  const t = useTranslations("employee.home");
  return (
    <div className="rounded-[--radius-card] border border-[--border] bg-[--surface] p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{date}</div>
        <div className="mt-1">
          <ExceptionBadge issue={issue} />
        </div>
      </div>
      <span className="text-xs text-[--text-muted]">{t("comingPhase5")}</span>
    </div>
  );
}
