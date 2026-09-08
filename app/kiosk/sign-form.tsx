"use client";

// Signing form shared by the self-serve kiosk and payday mode. The pad
// reports ink; Sign stays disabled until there is some. Navigation after
// success is done client-side: a redirect() thrown inside a directly
// invoked server action is not reliably honored by kiosk webviews.

import * as React from "react";
import { useRouter } from "next/navigation";
import { SignaturePad } from "@/components/domain/signature-pad";

export type SignActionResult = { ok: true; next: string } | { error: string };

export function PayslipSignForm({
  payslipId,
  action,
  copy,
}: {
  payslipId: string;
  action: (formData: FormData) => Promise<SignActionResult>;
  copy: {
    statement: string;
    hint: string;
    clear: string;
    sign: string;
    signing: string;
  };
}) {
  const router = useRouter();
  const [dataUrl, setDataUrl] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (!dataUrl || pending) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("payslipId", payslipId);
    form.set("signature", dataUrl);
    try {
      const result = await action(form);
      if ("error" in result) {
        setError(result.error);
        setPending(false);
        return;
      }
      router.replace(result.next);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold text-text">{copy.statement}</p>
      <SignaturePad
        onChange={setDataUrl}
        clearLabel={copy.clear}
        hint={copy.hint}
      />
      {error ? (
        <p
          role="alert"
          className="rounded-xl border-2 border-danger-200 bg-danger-50 px-4 py-3 text-center text-lg font-semibold text-danger-700"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={submit}
        disabled={!dataUrl || pending}
        className="h-16 w-full rounded-xl bg-brand-700 text-2xl font-bold text-white active:bg-brand-800 disabled:opacity-40"
      >
        {pending ? copy.signing : copy.sign}
      </button>
    </div>
  );
}
