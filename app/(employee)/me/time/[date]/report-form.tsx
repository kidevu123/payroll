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
import { timeOf } from "@/lib/time/format";

export function ReportFixForm({
  date,
  mode,
  isToday,
  initiallyOpen = false,
  returnTo = null,
}: {
  date: string;
  mode: EmployeeReportFixMode;
  /** Today's shift may still be running, so its clock-out stays optional. */
  isToday: boolean;
  /** Open straight into the form (arriving from "Fix hours" / "Add hours"). */
  initiallyOpen?: boolean;
  /** Validated server-side; where to land after sending. */
  returnTo?: string | null;
}) {
  const t = useTranslations("employee.day");
  const [open, setOpen] = React.useState(initiallyOpen);
  // Whole-day entry: nothing on file to complete, or one shift to correct.
  const onFileShift =
    mode.kind === "NO_PUNCH_OR_CORRECTION" ? mode.onFileShift : undefined;
  const closedLabel =
    mode.kind !== "NO_PUNCH_OR_CORRECTION"
      ? t("reportFix")
      : onFileShift
        ? t("fixHours")
        : t("addHours");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [unpairedMissingSide, setUnpairedMissingSide] = React.useState<
    "clockIn" | "clockOut"
  >("clockOut");

  if (!open) {
    return (
      // Primary, full width: this is the one action on the day screen, and as
      // a grey outline it read as part of the background.
      <Button size="lg" className="w-full" onClick={() => setOpen(true)}>
        <Flag className="h-4 w-4" /> {closedLabel}
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
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {mode.kind !== "NO_PUNCH_OR_CORRECTION" ? (
        <input type="hidden" name="issue" value={mode.kind} />
      ) : null}
      <p className="text-sm text-text-muted">
        {mode.kind !== "NO_PUNCH_OR_CORRECTION"
          ? t("missingPunchInstructions", { date })
          : onFileShift
            ? t("correctionInstructions", {
                clockIn: onFileShift.clockIn,
                clockOut: onFileShift.clockOut,
              })
            : t("noHoursInstructions")}
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
            required
            defaultValue={timeOf(mode.defaultClockIn)}
            label={t("clockIn")}
          />
          {/* A finished day needs both ends; the server enforces it too. */}
          <Field
            id="claimedClockOut"
            name="claimedClockOut"
            type="time"
            required={!isToday}
            defaultValue={timeOf(mode.defaultClockOut)}
            label={isToday ? t("clockOutOptionalToday") : t("clockOut")}
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
          {pending ? t("submitting") : t("sendForApproval")}
        </Button>
      </div>
    </form>
  );
}
