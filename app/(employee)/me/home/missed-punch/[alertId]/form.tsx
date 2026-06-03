"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitMissedPunchAction } from "./actions";
import type { MissedPunchIssue } from "@/lib/missed-punch/claim";

export function MissedPunchForm({
  alertId,
  date,
  issue,
  recordedClockIn,
  recordedClockOut,
  defaultClockOut,
}: {
  alertId: string;
  date: string;
  issue: MissedPunchIssue;
  /** Wall-clock label already on file (fingerprint), e.g. "8:07 AM". */
  recordedClockIn?: string | null;
  recordedClockOut?: string | null;
  defaultClockOut?: string;
}) {
  const t = useTranslations("employee.missedPunch");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const onlyOut = issue === "MISSING_OUT";
  const onlyIn = issue === "MISSING_IN";

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const r = await submitMissedPunchAction(alertId, form);
        setPending(false);
        if (r?.error) setError(r.error);
      }}
      className="space-y-3"
    >
      {onlyOut && recordedClockIn ? (
        <div className="rounded-input border border-border bg-surface-2 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
            {t("onFile")}
          </p>
          <p className="mt-1 font-medium">
            {t("clockIn")}: {recordedClockIn}
          </p>
          <p className="text-xs text-text-muted mt-1">{t("onFileHint")}</p>
        </div>
      ) : null}

      {onlyIn && recordedClockOut ? (
        <div className="rounded-input border border-border bg-surface-2 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
            {t("onFile")}
          </p>
          <p className="mt-1 font-medium">
            {t("clockOut")}: {recordedClockOut}
          </p>
          <p className="text-xs text-text-muted mt-1">{t("onFileHint")}</p>
        </div>
      ) : null}

      {onlyOut ? (
        <div className="space-y-1">
          <Label htmlFor="claimedClockOut">{t("enterClockOut")}</Label>
          <Input
            id="claimedClockOut"
            name="claimedClockOut"
            type="datetime-local"
            required
            defaultValue={defaultClockOut ?? `${date}T17:00`}
          />
        </div>
      ) : onlyIn ? (
        <div className="space-y-1">
          <Label htmlFor="claimedClockIn">{t("enterClockIn")}</Label>
          <Input
            id="claimedClockIn"
            name="claimedClockIn"
            type="datetime-local"
            required
            defaultValue={`${date}T08:00`}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="claimedClockIn">{t("clockIn")}</Label>
            <Input
              id="claimedClockIn"
              name="claimedClockIn"
              type="datetime-local"
              defaultValue={`${date}T08:00`}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="claimedClockOut">{t("clockOut")}</Label>
            <Input
              id="claimedClockOut"
              name="claimedClockOut"
              type="datetime-local"
              defaultValue={`${date}T16:00`}
            />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="reason">{t("whatHappened")}</Label>
        <textarea
          id="reason"
          name="reason"
          required
          minLength={1}
          maxLength={500}
          rows={3}
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submitFix")}
      </Button>
    </form>
  );
}
