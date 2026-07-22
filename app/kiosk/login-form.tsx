"use client";

// Kiosk sign-in: clock ID then PIN, all through one big on-screen keypad.
// Bilingual static labels — language preference applies after sign-in.

import * as React from "react";
import { Delete } from "lucide-react";
import { kioskLoginAction } from "./actions";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export function KioskLoginForm() {
  const [step, setStep] = React.useState<"id" | "pin">("id");
  const [clockId, setClockId] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const value = step === "id" ? clockId : pin;
  const setValue = step === "id" ? setClockId : setPin;
  const maxLen = step === "id" ? 10 : 6;

  const press = (d: string) => {
    setError(null);
    setValue((v) => (v.length >= maxLen ? v : v + d));
  };

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("clockId", clockId);
    form.set("pin", pin);
    const result = await kioskLoginAction(form);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      setPin("");
      setStep("pin");
    }
  };

  const next = () => {
    if (step === "id") {
      if (clockId.length === 0) return;
      setStep("pin");
    } else {
      if (pin.length < 4) return;
      void submit();
    }
  };

  return (
    <main className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          {step === "id" ? "Clock ID" : "PIN"}
        </h1>
        <p className="mt-1 text-lg text-text-muted">
          {step === "id" ? "Numero de reloj" : "Su PIN de 4-6 digitos"}
        </p>
      </div>

      <div
        className="mx-auto flex h-16 w-full max-w-xs items-center justify-center rounded-xl border-2 border-border bg-surface-2 text-4xl font-bold tracking-[0.3em] tabular-nums"
        aria-live="polite"
      >
        {step === "id" ? value || " " : "•".repeat(pin.length)}
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-auto w-full max-w-sm rounded-xl border-2 border-danger-200 bg-danger-50 px-4 py-3 text-center text-lg font-semibold text-danger-700"
        >
          {error}
        </p>
      ) : null}

      <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-3">
        {KEYS.slice(0, 9).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className="h-20 rounded-xl border-2 border-border bg-surface text-3xl font-bold active:bg-surface-2"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setError(null);
            setValue("");
          }}
          className="h-20 rounded-xl border-2 border-border bg-surface text-lg font-semibold text-text-muted active:bg-surface-2"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => press("0")}
          className="h-20 rounded-xl border-2 border-border bg-surface text-3xl font-bold active:bg-surface-2"
        >
          0
        </button>
        <button
          type="button"
          aria-label="Delete"
          onClick={() => {
            setError(null);
            setValue((v) => v.slice(0, -1));
          }}
          className="flex h-20 items-center justify-center rounded-xl border-2 border-border bg-surface active:bg-surface-2"
        >
          <Delete className="h-8 w-8" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-sm gap-3">
        {step === "pin" ? (
          <button
            type="button"
            onClick={() => {
              setStep("id");
              setPin("");
              setError(null);
            }}
            className="h-16 flex-1 rounded-xl border-2 border-border text-xl font-semibold text-text-muted active:bg-surface-2"
          >
            Back / Atras
          </button>
        ) : null}
        <button
          type="button"
          onClick={next}
          disabled={pending || (step === "id" ? clockId.length === 0 : pin.length < 4)}
          className="h-16 flex-[2] rounded-xl bg-brand-700 text-2xl font-bold text-white disabled:opacity-40 active:bg-brand-800"
        >
          {pending ? "..." : step === "id" ? "Next / Siguiente" : "Sign in / Entrar"}
        </button>
      </div>
    </main>
  );
}
