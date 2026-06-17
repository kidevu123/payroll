"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, Clock3, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Field,
  SelectField,
  TextareaField,
  FormError,
} from "@/components/employee/form-field";
import { submitTimeOffAction } from "./actions";

type DayOffType = "PERSONAL" | "SICK" | "UNPAID" | "OTHER";
type RequestMode = "DAY_OFF" | "SCHEDULE_NOTE";

export function TimeOffForm({
  isHourly,
  defaultDate,
}: {
  isHourly: boolean;
  defaultDate: string;
}) {
  const t = useTranslations("employee.timeOff");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const [mode, setMode] = React.useState<RequestMode>("DAY_OFF");
  // Hourly employees submit unpaid full-day leave; salaried employees keep
  // the paid-time-off default and can choose their leave bucket.
  const [dayOffType, setDayOffType] = React.useState<DayOffType>(
    isHourly ? "UNPAID" : "PERSONAL",
  );
  const isPartial = mode === "SCHEDULE_NOTE";
  const type = isPartial ? "SCHEDULE_NOTE" : dayOffType;

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const r = await submitTimeOffAction(form);
        setPending(false);
        if (r?.error) setError(r.error);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>{t("requestKind")}</Label>
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={mode === "DAY_OFF"}
            icon={CalendarDays}
            label={t("dayOffMode")}
            onClick={() => setMode("DAY_OFF")}
          />
          <ModeButton
            active={mode === "SCHEDULE_NOTE"}
            icon={Clock3}
            label={t("scheduleChangeMode")}
            onClick={() => setMode("SCHEDULE_NOTE")}
          />
        </div>
      </div>
      <input type="hidden" name="type" value={type} />

      {isPartial ? (
        <div className="space-y-4">
          <SingleDateField defaultValue={defaultDate} />
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="partialStartTime"
              name="partialStartTime"
              type="time"
              label={t("arriveAt")}
            />
            <Field
              id="partialEndTime"
              name="partialEndTime"
              type="time"
              label={t("leaveAt")}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!isHourly && (
            <SelectField
              id="dayOffType"
              label={t("type")}
              value={dayOffType}
              onChange={(e) => setDayOffType(e.target.value as DayOffType)}
            >
              <option value="PERSONAL">{t("personalLabel")}</option>
              <option value="SICK">{t("sickLabel")}</option>
              <option value="UNPAID">{t("unpaidLabel")}</option>
              <option value="OTHER">{t("otherLabel")}</option>
            </SelectField>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={defaultDate}
              required
              label={t("start")}
            />
            <Field
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={defaultDate}
              required
              label={t("end")}
            />
          </div>
        </div>
      )}

      <TextareaField
        id="reason"
        name="reason"
        maxLength={500}
        label={t("reasonOptional")}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submitRequest")}
      </Button>
    </form>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-12 items-center justify-center gap-2 rounded-input border px-2 text-sm font-medium transition-colors ${
        active
          ? "border-brand-300 bg-brand-50 text-brand-900"
          : "border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 text-center leading-tight">{label}</span>
    </button>
  );
}

function SingleDateField({ defaultValue }: { defaultValue: string }) {
  const t = useTranslations("employee.timeOff");
  const [date, setDate] = React.useState(defaultValue);
  return (
    <div className="space-y-1.5">
      <Field
        id="schedDate"
        name="startDate"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
        label={t("date")}
      />
      <input type="hidden" name="endDate" value={date} />
    </div>
  );
}
