"use client";

// Payday code entry: six digits on the shared keypad. Navigation after
// unlock is client-side (see sign-form.tsx for why).

import * as React from "react";
import { useRouter } from "next/navigation";
import { Keypad } from "../keypad";
import { paydayUnlockAction } from "./actions";

export function PaydayCodeForm() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const submit = async () => {
    if (pending || code.length < 6) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("code", code);
    const result = await paydayUnlockAction(form);
    if ("error" in result) {
      setError(result.error);
      setCode("");
      setPending(false);
      return;
    }
    router.replace(result.next);
    router.refresh();
  };

  return (
    <main className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Payday signing</h1>
        <p className="mt-1 text-lg text-text-muted">
          Enter the 6-digit code from the office
        </p>
      </div>
      <div
        className="mx-auto flex h-16 w-full max-w-xs items-center justify-center rounded-xl border-2 border-border bg-surface-2 text-4xl font-bold tracking-[0.3em] tabular-nums"
        aria-live="polite"
      >
        {code || " "}
      </div>
      {error ? (
        <p
          role="alert"
          className="mx-auto w-full max-w-sm rounded-xl border-2 border-danger-200 bg-danger-50 px-4 py-3 text-center text-lg font-semibold text-danger-700"
        >
          {error}
        </p>
      ) : null}
      <Keypad
        onPress={(d) => {
          setError(null);
          setCode((v) => (v.length >= 6 ? v : v + d));
        }}
        onClear={() => {
          setError(null);
          setCode("");
        }}
        onDelete={() => {
          setError(null);
          setCode((v) => v.slice(0, -1));
        }}
      />
      <div className="mx-auto flex w-full max-w-sm gap-3">
        <a
          href="/kiosk"
          className="flex h-16 flex-1 items-center justify-center rounded-xl border-2 border-border text-xl font-semibold text-text-muted active:bg-surface-2"
        >
          Back
        </a>
        <button
          type="button"
          onClick={submit}
          disabled={pending || code.length < 6}
          className="h-16 flex-[2] rounded-xl bg-brand-700 text-2xl font-bold text-white disabled:opacity-40 active:bg-brand-800"
        >
          {pending ? "..." : "Unlock"}
        </button>
      </div>
    </main>
  );
}
