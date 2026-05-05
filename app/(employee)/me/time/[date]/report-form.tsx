"use client";

import * as React from "react";
import { Flag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reportPunchFixAction } from "./actions";

export function ReportFixForm({
  date,
  defaultIn,
  defaultOut,
}: {
  date: string;
  defaultIn?: string;
  defaultOut?: string;
}) {
  const t = useTranslations("employee.day");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
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
      className="space-y-3 rounded-card border border-border bg-surface-2 p-4 shadow-sm"
    >
      <input type="hidden" name="date" value={date} />
      <p className="text-sm text-text-muted">
        {t("reportInstructions", { date })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="claimedClockIn">{t("correctClockIn")}</Label>
          <Input
            id="claimedClockIn"
            name="claimedClockIn"
            type="datetime-local"
            defaultValue={defaultIn ?? `${date}T08:00`}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="claimedClockOut">{t("correctClockOutOptional")}</Label>
          <Input
            id="claimedClockOut"
            name="claimedClockOut"
            type="datetime-local"
            defaultValue={defaultOut ?? ""}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="reason">{t("whatHappened")}</Label>
        <textarea
          id="reason"
          name="reason"
          required
          minLength={1}
          maxLength={500}
          rows={3}
          placeholder={t("reasonPlaceholder")}
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("submitting") : t("sendToAdmin")}
        </Button>
      </div>
    </form>
  );
}
