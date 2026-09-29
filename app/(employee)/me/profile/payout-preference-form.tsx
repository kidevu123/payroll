"use client";

// Self-service payout preference card: cash or Zelle, with the Zelle
// phone/email shown only when Zelle is picked. Display-only for the
// office — nothing in payroll reads it. Error codes from the action map
// to i18n strings.

import * as React from "react";
import { Wallet, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormError, SideRadio } from "@/components/employee/form-field";
import type { PayoutPreference } from "@/lib/employees/zelle-contact";
import { savePayoutPreferenceAction } from "./actions";

export function PayoutPreferenceForm({
  preference,
  zelleContact,
}: {
  /** Null = the employee has not chosen yet. */
  preference: PayoutPreference | null;
  zelleContact: string | null;
}) {
  const t = useTranslations("employee.profile");
  const [choice, setChoice] = React.useState<PayoutPreference | null>(
    preference,
  );
  // Controlled: React resets uncontrolled fields after a form action, which
  // would wipe what the employee typed whenever validation fails.
  const [contact, setContact] = React.useState(zelleContact ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const choose = (next: PayoutPreference) => {
    setChoice(next);
    setError(null);
    setSaved(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-brand-700" />
          {t("payoutTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            setSaved(false);
            const result = await savePayoutPreferenceAction(form);
            setPending(false);
            if (!result.error) {
              setContact(result.zelleContact ?? "");
              setSaved(true);
              return;
            }
            setError(
              result.error === "ZELLE_CONTACT_REQUIRED"
                ? t("zelleContactRequired")
                : result.error === "ZELLE_CONTACT_INVALID"
                  ? t("zelleContactInvalid")
                  : result.error === "NOT_LINKED"
                    ? t("payoutNotLinked")
                    : t("payoutChoose"),
            );
          }}
          className="space-y-3"
        >
          <p className="text-sm text-text-muted leading-relaxed">
            {t("payoutHint")}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <SideRadio
              name="payoutPreference"
              value="CASH"
              label={t("payoutCash")}
              checked={choice === "CASH"}
              onChange={() => choose("CASH")}
            />
            <SideRadio
              name="payoutPreference"
              value="ZELLE"
              label={t("payoutZelle")}
              checked={choice === "ZELLE"}
              onChange={() => choose("ZELLE")}
            />
          </div>
          {choice === "ZELLE" ? (
            <div className="space-y-1.5">
              <Field
                id="zelle-contact"
                name="zelleContact"
                value={contact}
                onChange={(ev) => {
                  setContact(ev.target.value);
                  setSaved(false);
                }}
                placeholder={t("zelleContactPlaceholder")}
                required
                maxLength={254}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                label={t("zelleContactLabel")}
              />
              <p className="text-[11px] text-text-muted leading-relaxed">
                {t("zelleContactHint")}
              </p>
            </div>
          ) : null}
          <FormError message={error} />
          {saved ? (
            <p className="flex items-center gap-1.5 rounded-input border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {t("payoutSaved")}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={pending || choice === null}
            className="w-full sm:w-auto"
          >
            {pending ? t("payoutSaving") : t("payoutSave")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
