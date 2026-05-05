"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitTimeOffAction } from "./actions";

export function TimeOffForm() {
  const t = useTranslations("employee.timeOff");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);
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
      <div className="space-y-1">
        <Label htmlFor="type">{t("type")}</Label>
        <select
          id="type"
          name="type"
          defaultValue="PERSONAL"
          className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
        >
          <option value="PERSONAL">{t("personalLabel")}</option>
          <option value="SICK">{t("sickLabel")}</option>
          <option value="UNPAID">{t("unpaidLabel")}</option>
          <option value="OTHER">{t("otherLabel")}</option>
        </select>
      </div>
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
