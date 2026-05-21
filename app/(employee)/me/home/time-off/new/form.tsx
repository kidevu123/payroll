"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, Clock3, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitTimeOffAction } from "./actions";

type DayOffType = "PERSONAL" | "SICK" | "UNPAID" | "OTHER";
type RequestMode = "DAY_OFF" | "SCHEDULE_NOTE";

export function TimeOffForm({ isHourly }: { isHourly: boolean }) {
  const t = useTranslations("employee.timeOff");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);

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
      className="space-y-3"
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
        <div className="space-y-3">
          <SingleDateField defaultValue={today} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="partialStartTime">{t("arriveAt")}</Label>
              <Input
                id="partialStartTime"
                name="partialStartTime"
                type="time"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partialEndTime">{t("leaveAt")}</Label>
              <Input
                id="partialEndTime"
                name="partialEndTime"
                type="time"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!isHourly && (
            <div className="space-y-1">
              <Label htmlFor="dayOffType">{t("type")}</Label>
              <select
                id="dayOffType"
                value={dayOffType}
                onChange={(e) => setDayOffType(e.target.value as DayOffType)}
                className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
              >
                <option value="PERSONAL">{t("personalLabel")}</option>
                <option value="SICK">{t("sickLabel")}</option>
                <option value="UNPAID">{t("unpaidLabel")}</option>
                <option value="OTHER">{t("otherLabel")}</option>
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="startDate">{t("start")}</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                defaultValue={today}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="endDate">{t("end")}</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                defaultValue={today}
                required
              />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="reason">{t("reasonOptional")}</Label>
        <textarea
          id="reason"
          name="reason"
          maxLength={500}
          rows={3}
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
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
    <div className="space-y-1">
      <Label htmlFor="schedDate">{t("date")}</Label>
      <Input
        id="schedDate"
        name="startDate"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />
      <input type="hidden" name="endDate" value={date} />
    </div>
  );
}
