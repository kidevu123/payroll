"use client";

// "Payday signing" — mints the 6-digit code the owner types into the
// warehouse tablet. Shown big so it can be read across the desk; the
// tablet flow itself lives at /kiosk/payday.

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PenLine, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPaydayCodeAction } from "./payroll-docs-actions";

export function PaydaySigningButton({
  periodId,
  periodLabel,
}: {
  periodId: string;
  periodLabel: string;
}) {
  const [code, setCode] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!expiresAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);

  const mint = async () => {
    setPending(true);
    setError(null);
    const result = await createPaydayCodeAction(periodId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setCode(result.code);
    setExpiresAt(new Date(result.expiresAt));
  };

  const remainingS = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000)) : 0;
  const expired = code !== null && remainingS === 0;

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (open && !code) void mint();
      }}
    >
      <Dialog.Trigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <PenLine className="h-4 w-4" /> Payday signing
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-[60] w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 overflow-hidden rounded-card border border-border bg-surface shadow-pop">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
            <div>
              <Dialog.Title className="text-base font-semibold tracking-tight">
                Payday signing on the tablet
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-muted">
                {periodLabel}. On the warehouse tablet, tap "Payday signing" under the
                kiosk sign-in and enter this code. Employees then tap their own name
                and sign; the list shows names only.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-input text-text-muted hover:bg-surface-2/40 hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="space-y-4 px-5 py-6 text-center">
            {error ? (
              <p className="rounded-input border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                {error}
              </p>
            ) : null}
            <p
              className={`font-mono text-5xl font-semibold tracking-[0.35em] tabular-nums ${expired ? "text-text-subtle line-through" : "text-text"}`}
              aria-live="polite"
            >
              {code ?? "······"}
            </p>
            <p className="text-sm text-text-muted tabular-nums">
              {code === null
                ? pending
                  ? "Generating…"
                  : ""
                : expired
                  ? "Code expired. Generate a new one."
                  : `Single use · expires in ${Math.floor(remainingS / 60)}:${String(remainingS % 60).padStart(2, "0")}`}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={mint} disabled={pending}>
              <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} /> New code
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
