"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Field,
  TextareaField,
  FormError,
  SideRadio,
} from "@/components/employee/form-field";
import { submitMissedPunchAction } from "./actions";
import type { MissedPunchIssue } from "@/lib/missed-punch/claim";

export function MissedPunchForm({
  alertId,
  date,
  issue,
  recordedClockIn,
  recordedClockOut,
  recordedUnpairedPunch,
  defaultClockOut,
}: {
  alertId: string;
  date: string;
  issue: MissedPunchIssue;
  /** Wall-clock label already on file (fingerprint), e.g. "8:07 AM". */
  recordedClockIn?: string | null;
  recordedClockOut?: string | null;
  recordedUnpairedPunch?: string | null;
  defaultClockOut?: string;
}) {
  const t = useTranslations("employee.missedPunch");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [unpairedMissingSide, setUnpairedMissingSide] = React.useState<
    "clockIn" | "clockOut"
  >("clockOut");

  const onlyOut = issue === "MISSING_OUT";
  const onlyIn = issue === "MISSING_IN";
  const unpaired = issue === "UNPAIRED_PUNCH";

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const r = await submitMissedPunchAction(alertId, form);
        setPending(false);
        if (r?.error) setError(r.error);
      }}
      className="space-y-4"
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

      {unpaired && recordedUnpairedPunch ? (
        <div className="rounded-input border border-border bg-surface-2 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
            {t("unpairedOnFile")}
          </p>
          <p className="mt-1 font-medium">{recordedUnpairedPunch}</p>
          <p className="text-xs text-text-muted mt-1">{t("unpairedOnFileHint")}</p>
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
        <Field
          id="claimedClockOut"
          name="claimedClockOut"
          type="datetime-local"
          required
          defaultValue={defaultClockOut ?? `${date}T17:00`}
          label={t("enterClockOut")}
        />
      ) : onlyIn ? (
        <Field
          id="claimedClockIn"
          name="claimedClockIn"
          type="datetime-local"
          required
          defaultValue={`${date}T08:00`}
          label={t("enterClockIn")}
        />
      ) : unpaired ? (
        <div className="space-y-3">
          <p className="text-sm text-text-muted leading-relaxed">
            {t("enterMissingPunch")}
          </p>
          <fieldset className="grid gap-2">
            <legend className="sr-only">{t("missingSideLabel")}</legend>
            <SideRadio
              checked={unpairedMissingSide === "clockOut"}
              onChange={() => setUnpairedMissingSide("clockOut")}
              value="clockOut"
              label={t("missingClockOutChoice")}
            />
            <SideRadio
              checked={unpairedMissingSide === "clockIn"}
              onChange={() => setUnpairedMissingSide("clockIn")}
              value="clockIn"
              label={t("missingClockInChoice")}
            />
          </fieldset>
          {unpairedMissingSide === "clockOut" ? (
            <Field
              id="claimedClockOut"
              name="claimedClockOut"
              type="datetime-local"
              required
              defaultValue={defaultClockOut ?? `${date}T17:00`}
              label={t("enterClockOut")}
            />
          ) : (
            <Field
              id="claimedClockIn"
              name="claimedClockIn"
              type="datetime-local"
              required
              defaultValue={`${date}T08:00`}
              label={t("enterClockIn")}
            />
          )}
          <p className="text-xs text-text-muted leading-relaxed">
            {t("existingPunchStays")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="claimedClockIn"
            name="claimedClockIn"
            type="datetime-local"
            defaultValue={`${date}T08:00`}
            label={t("clockIn")}
          />
          <Field
            id="claimedClockOut"
            name="claimedClockOut"
            type="datetime-local"
            defaultValue={`${date}T16:00`}
            label={t("clockOut")}
          />
        </div>
      )}

      <TextareaField
        id="reason"
        name="reason"
        required
        minLength={1}
        maxLength={500}
        label={t("whatHappened")}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submitFix")}
      </Button>
    </form>
  );
}
