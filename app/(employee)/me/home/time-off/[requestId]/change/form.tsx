"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      className="space-y-3"
    >
      <div className="space-y-1">
        <Label htmlFor="changeType">{t("type")}</Label>
        <select
          id="changeType"
          name="type"
          defaultValue={isHourly ? "UNPAID" : initial.type}
          className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
        >
          {!isHourly ? <option value="PERSONAL">{t("personalLabel")}</option> : null}
          {!isHourly ? <option value="SICK">{t("sickLabel")}</option> : null}
          <option value="UNPAID">{t("unpaidLabel")}</option>
          <option value="OTHER">{t("otherLabel")}</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="changeStartDate">{t("start")}</Label>
          <Input
            id="changeStartDate"
            name="startDate"
            type="date"
            defaultValue={initial.startDate}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="changeEndDate">{t("end")}</Label>
          <Input
            id="changeEndDate"
            name="endDate"
            type="date"
            defaultValue={initial.endDate}
            required
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="changeReason">{t("reasonOptional")}</Label>
        <textarea
          id="changeReason"
          name="reason"
          rows={3}
          maxLength={500}
          defaultValue={initial.reason}
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      {error ? <p className="text-sm text-danger-700">{error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submitChange")}
      </Button>
    </form>
  );
}
