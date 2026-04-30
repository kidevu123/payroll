"use client";

import { useState, useTransition } from "react";
import { saveCompany } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompanySettings } from "@/lib/settings/schemas";

export function CompanyForm({ initial }: { initial: CompanySettings }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await saveCompany(fd);
          if (res?.error) setError(res.error);
          else setSuccess(true);
        });
      }}
      className="space-y-5 max-w-xl"
    >
      <Field label="Company name" name="name" defaultValue={initial.name} required />
      <Field label="Address" name="address" defaultValue={initial.address} />
      <Field
        label="Brand color"
        name="brandColorHex"
        defaultValue={initial.brandColorHex}
        type="color"
      />
      <Field label="Timezone" name="timezone" defaultValue={initial.timezone} />
      <Field label="Locale" name="locale" defaultValue={initial.locale} />

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {success ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  type,
}: {
  label: string;
  name: string;
  defaultValue: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type ?? "text"} defaultValue={defaultValue} required={required} />
    </div>
  );
}
