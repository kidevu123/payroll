"use client";

// Self-service kiosk PIN card. Numeric-only inputs with a confirm field
// (a typo here means being locked out at the kiosk), phone-sized targets,
// inline success state. Error codes from the action map to i18n strings.

import * as React from "react";
import { KeyRound, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/employee/form-field";
import { setKioskPinAction } from "./actions";

export function KioskPinForm({
  pinSet,
  clockId,
}: {
  pinSet: boolean;
  /** NGTeco clock ID — the number they type at the kiosk. Null = unassigned. */
  clockId: string | null;
}) {
  const t = useTranslations("employee.profile");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-brand-700" />
          {t("kioskPinTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-input border border-brand-200 bg-brand-50 px-3 py-2.5">
          <span className="text-sm font-medium text-brand-900">
            {t("clockIdLabel")}
          </span>
          {clockId ? (
            <span className="text-xl font-bold tabular-nums tracking-widest text-brand-900">
              {clockId}
            </span>
          ) : (
            <span className="text-sm text-text-muted">
              {t("clockIdMissing")}
            </span>
          )}
        </div>
        <form
          ref={formRef}
          action={async (form) => {
            setPending(true);
            setError(null);
            setSaved(false);
            const result = await setKioskPinAction(form);
            setPending(false);
            if (result.error) {
              setError(
                result.error === "PIN_MISMATCH"
                  ? t("kioskPinMismatch")
                  : t("kioskPinInvalid"),
              );
            } else {
              setSaved(true);
              formRef.current?.reset();
            }
          }}
          className="space-y-3"
        >
          <p className="text-sm text-text-muted leading-relaxed">
            {pinSet || saved ? t("kioskPinSetHint") : t("kioskPinUnsetHint")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="kiosk-pin"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              minLength={4}
              maxLength={6}
              required
              autoComplete="off"
              label={t("kioskPinNew")}
            />
            <Field
              id="kiosk-pin-confirm"
              name="pinConfirm"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              minLength={4}
              maxLength={6}
              required
              autoComplete="off"
              label={t("kioskPinConfirm")}
            />
          </div>
          <FormError message={error} />
          {saved ? (
            <p className="flex items-center gap-1.5 rounded-input border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {t("kioskPinSaved")}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending
              ? t("kioskPinSaving")
              : pinSet || saved
                ? t("kioskPinReplace")
                : t("kioskPinSave")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
