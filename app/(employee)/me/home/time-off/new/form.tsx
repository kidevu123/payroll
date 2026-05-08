"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitTimeOffAction } from "./actions";

type RequestType = "PERSONAL" | "SICK" | "UNPAID" | "OTHER" | "SCHEDULE_NOTE";

export function TimeOffForm({ isHourly }: { isHourly: boolean }) {
  const t = useTranslations("employee.timeOff");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);

  // Hourly defaults to UNPAID (the most common request for them);
  // salaried defaults to PERSONAL (the existing behavior).
  const [type, setType] = React.useState<RequestType>(
    isHourly ? "UNPAID" : "PERSONAL",
  );
  const isPartial = type === "SCHEDULE_NOTE";

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
      <div className="space-y-1">
        <Label htmlFor="type">{t("type")}</Label>
        <select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as RequestType)}
          className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
        >
          {/* PTO types only render for non-hourly. Hourly employees
              don't accrue paid time off, so showing PERSONAL/SICK
              would be misleading. */}
          {!isHourly && (
            <>
              <option value="PERSONAL">{t("personalLabel")}</option>
              <option value="SICK">{t("sickLabel")}</option>
            </>
          )}
          <option value="UNPAID">{t("unpaidLabel")}</option>
          <option value="OTHER">{t("otherLabel")}</option>
          <option value="SCHEDULE_NOTE">
            Schedule note (heads-up — leaving early / coming in late)
          </option>
        </select>
        {type === "SCHEDULE_NOTE" && (
          <p className="text-[11px] text-text-muted">
            Auto-acknowledged. Use this when you&apos;re still working
            the day but need admin to know your hours will shift.
          </p>
        )}
      </div>

      {isPartial ? (
        <div className="space-y-3">
          <SingleDateField defaultValue={today} />
          {/* SCHEDULE_NOTE is single-day; SingleDateField submits the
              chosen date for both startDate and endDate so the
              action's existing date-range validation stays happy. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="partialStartTime">In at (leave blank if normal)</Label>
              <Input
                id="partialStartTime"
                name="partialStartTime"
                type="time"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="partialEndTime">Leaving at (blank if normal)</Label>
              <Input
                id="partialEndTime"
                name="partialEndTime"
                type="time"
              />
            </div>
          </div>
          <p className="text-[11px] text-text-muted">
            Fill at least one. Both = &ldquo;out from X to Y for an
            appointment.&rdquo; Just an end time = &ldquo;leaving early
            at X.&rdquo; Just a start time = &ldquo;coming in late at
            X.&rdquo;
          </p>
        </div>
      ) : (
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

/** Single-day date input that submits the same value for both
 *  startDate and endDate. Used by SCHEDULE_NOTE since the action's
 *  validator still expects a date range. */
function SingleDateField({ defaultValue }: { defaultValue: string }) {
  const [date, setDate] = React.useState(defaultValue);
  return (
    <div className="space-y-1">
      <Label htmlFor="schedDate">Date</Label>
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
