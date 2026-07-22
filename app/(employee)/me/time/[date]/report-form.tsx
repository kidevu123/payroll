"use client";

import * as React from "react";
import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Field,
  FormError,
  SideRadio,
} from "@/components/employee/form-field";
import { ReasonField } from "@/components/employee/reason-field";
import { reportPunchFixAction } from "./actions";
import type { EmployeeReportFixMode } from "@/lib/missed-punch/employee-report-mode";

/** "2026-07-13T08:00" (report-mode default) -> "08:00" for <input type="time">. */
function timeOf(value: string): string {
  const t = value.indexOf("T");
  return t === -1 ? value : value.slice(t + 1);
}

export function ReportFixForm({
  date,
  mode,
}: {
  date: string;
  mode: EmployeeReportFixMode;
}) {
  const t = useTranslations("employee.day");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [unpairedMissingSide, setUnpairedMissingSide] = React.useState<
    "clockIn" | "clockOut"
  >("clockOut");

  if (!open) {
    return (
      <Button
        size="lg"
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <Flag className="h-4 w-4" /> {t("reportFix")}
      </Button>
    );
  }

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await reportPunchFixAction(form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-4 rounded-card border border-border bg-surface-2 p-4 shadow-card"
    >
      <input type="hidden" name="date" value={date} />
      {mode.kind !== "NO_PUNCH_OR_CORRECTION" ? (
        <input type="hidden" name="issue" value={mode.kind} />
      ) : null}
      <p className="text-sm text-text-muted">
        {mode.kind === "NO_PUNCH_OR_CORRECTION"
          ? t("reportInstructions", { date })
          : t("missingPunchInstructions", { date })}
      </p>
      {mode.kind === "MISSING_OUT" ? (
        <>
          <div className="rounded-input border border-border bg-surface px-3 py-2.5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("onFile")}
            </p>
            <p className="mt-1 font-medium">
              {t("clockIn")}: {mode.recordedClockIn}
            </p>
            <p className="mt-1 text-xs text-text-muted leading-relaxed">
              {t("onFileHint")}
            </p>
          </div>
          <Field
            id="claimedClockOut"
            name="claimedClockOut"
            type="time"
            required
            defaultValue={timeOf(mode.defaultClockOut)}
            label={t("enterClockOut")}
          />
        </>
      ) : mode.kind === "MISSING_IN" ? (
        <>
          <div className="rounded-input border border-border bg-surface px-3 py-2.5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("onFile")}
            </p>
            <p className="mt-1 font-medium">
              {t("clockOut")}: {mode.recordedClockOut}
            </p>
            <p className="mt-1 text-xs text-text-muted leading-relaxed">
              {t("onFileHint")}
            </p>
          </div>
          <Field
            id="claimedClockIn"
            name="claimedClockIn"
            type="time"
            required
            defaultValue={timeOf(mode.defaultClockIn)}
            label={t("enterClockIn")}
          />
        </>
      ) : mode.kind === "UNPAIRED_PUNCH" ? (
        <div className="space-y-3">
          <div className="rounded-input border border-border bg-surface px-3 py-2.5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("unpairedOnFile")}
            </p>
            <p className="mt-1 font-medium">{mode.recordedUnpairedPunch}</p>
            <p className="mt-1 text-xs text-text-muted leading-relaxed">
              {t("unpairedOnFileHint")}
            </p>
          </div>
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
              type="time"
              required
              defaultValue={timeOf(mode.defaultClockOut)}
              label={t("enterClockOut")}
            />
          ) : (
            <Field
              id="claimedClockIn"
              name="claimedClockIn"
              type="time"
              required
              defaultValue={timeOf(mode.defaultClockIn)}
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
            type="time"
            defaultValue={timeOf(mode.defaultClockIn)}
            label={t("correctClockIn")}
          />
          <Field
            id="claimedClockOut"
            name="claimedClockOut"
            type="time"
            defaultValue={timeOf(mode.defaultClockOut)}
            label={t("correctClockOutOptional")}
          />
        </div>
      )}
      <ReasonField
        id="reason"
        label={t("whatHappened")}
        placeholder={t("reasonPlaceholder")}
        quickReasons={[
          t("reasonQuickForgot"),
          t("reasonQuickClock"),
          t("reasonQuickLeftEarly"),
        ]}
      />
      <FormError message={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          size="lg"
          variant="ghost"
          className="w-full sm:w-auto"
          onClick={() => setOpen(false)}
        >
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto"
          disabled={pending}
        >
          {pending ? t("submitting") : t("sendToAdmin")}
        </Button>
      </div>
    </form>
  );
}
