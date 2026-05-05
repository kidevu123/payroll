"use client";

import * as React from "react";
import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Employee } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveProfileAction } from "./actions";

export function ProfileForm({ employee }: { employee: Employee }) {
  const t = useTranslations("employee.profile");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("editablePreferences")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            setSaved(false);
            const result = await saveProfileAction(form);
            setPending(false);
            if (result?.error) setError(result.error);
            else setSaved(true);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="displayName">{t("displayName")}</Label>
            <Input
              id="displayName"
              name="displayName"
              defaultValue={employee.displayName}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input
              id="phone"
              name="phone"
              defaultValue={employee.phone ?? ""}
              placeholder="+15551234567"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="birthday">{t("birthday")}</Label>
            <Input
              id="birthday"
              name="birthday"
              type="date"
              defaultValue={employee.birthday ?? ""}
            />
            <p className="text-[11px] text-text-subtle">{t("birthdayHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="language">{t("language")}</Label>
            <select
              id="language"
              name="language"
              defaultValue={employee.language}
              className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm transition-colors focus-visible:outline-none focus-visible:border-brand-700 focus-visible:ring-2 focus-visible:ring-brand-700/30"
            >
              <option value="en">{t("languageEn")}</option>
              <option value="es">{t("languageEs")}</option>
            </select>
          </div>
          {error && (
            <p className="rounded-input border border-danger-200/80 bg-danger-50 px-3 py-2 text-xs text-danger-700">
              {error}
            </p>
          )}
          {saved && (
            <p className="inline-flex items-center gap-1.5 rounded-input border border-success-200/80 bg-success-50 px-3 py-2 text-xs font-medium text-success-700">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden />
              {t("saved")}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? t("saving") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
