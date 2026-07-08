"use client";

import * as React from "react";
import { AlertTriangle, CircleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { reportPayslipProblemAction } from "./actions";

/**
 * Inline expandable problem-report form. Hidden until the employee taps
 * "Report a problem"; expands to a textarea + submit. Submitting writes
 * a dispute on the payslip and notifies admins.
 *
 * Uses the warn-* token palette so the surface picks up dark-mode
 * automatically; no hard-coded amber-50/etc shades.
 */
export function ReportProblemButton({
  payslipId,
  alreadyDisputed,
}: {
  payslipId: string;
  alreadyDisputed: boolean;
}) {
  const t = useTranslations("employee.pay");
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  if (done || alreadyDisputed) {
    return (
      <div className="inline-flex items-center gap-2 rounded-input border border-warn-200/80 bg-warn-50 px-3 py-2 text-xs font-medium text-warn-700">
        <CircleAlert className="h-3.5 w-3.5" aria-hidden />
        <span>{t("problemNotified")}</span>
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-warn-700 hover:bg-warn-50 hover:text-warn-700"
      >
        <AlertTriangle className="h-4 w-4" /> {t("reportProblem")}
      </Button>
    );
  }

  return (
    <div className="w-full rounded-card border border-warn-200/80 bg-warn-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium tracking-tight text-warn-700 antialiased">
          {t("whatsWrong")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-warn-700 hover:bg-warn-50"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
          }}
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <textarea
        className="w-full h-24 rounded-input border border-border bg-surface px-3 py-2 text-sm leading-relaxed transition-colors focus-visible:outline-none focus-visible:border-warn-700 focus-visible:ring-2 focus-visible:ring-warn-200"
        placeholder={t("problemPlaceholder")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
        maxLength={1000}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-muted tabular-nums">
          {reason.length}/1000
        </span>
        {error && <span className="text-xs text-danger-700">{error}</span>}
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={pending || reason.trim().length < 5}
          onClick={async () => {
            setPending(true);
            setError(null);
            const r = await reportPayslipProblemAction(payslipId, reason);
            setPending(false);
            if (r?.error) {
              setError(r.error);
              return;
            }
            setDone(true);
          }}
        >
          {pending ? t("sending") : t("sendReport")}
        </Button>
      </div>
    </div>
  );
}
