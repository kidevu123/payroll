"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Field,
  SelectField,
  TextareaField,
  FormError,
} from "@/components/employee/form-field";
import { submitMyTimeOffChangeAction } from "../../new/actions";

type DayOffType = "PERSONAL" | "SICK" | "UNPAID" | "OTHER";

export function ChangeTimeOffForm({
  requestId,
  isHourly,
  initial,
}: {
  requestId: string;
  isHourly: boolean;
  initial: {
    startDate: string;
    endDate: string;
    type: DayOffType;
    reason: string;
  };
}) {
  const t = useTranslations("employee.timeOff");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await submitMyTimeOffChangeAction(requestId, form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-4"
    >
      <SelectField
        id="changeType"
        name="type"
        defaultValue={isHourly ? "UNPAID" : initial.type}
        label={t("type")}
      >
        {!isHourly ? <option value="PERSONAL">{t("personalLabel")}</option> : null}
        {!isHourly ? <option value="SICK">{t("sickLabel")}</option> : null}
        <option value="UNPAID">{t("unpaidLabel")}</option>
        <option value="OTHER">{t("otherLabel")}</option>
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="changeStartDate"
          name="startDate"
          type="date"
          defaultValue={initial.startDate}
          required
          label={t("start")}
        />
        <Field
          id="changeEndDate"
          name="endDate"
          type="date"
          defaultValue={initial.endDate}
          required
          label={t("end")}
        />
      </div>
      <TextareaField
        id="changeReason"
        name="reason"
        maxLength={500}
        defaultValue={initial.reason}
        label={t("reasonOptional")}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submitChange")}
      </Button>
    </form>
  );
}
