"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";

const LABELS: Record<string, string> = { en: "EN", es: "ES" };

/**
 * Two-button language toggle. Posts to /api/locale, refreshes the route
 * tree so server components re-render with the new strings.
 */
export function LanguageSwitcher({ current }: { current: "en" | "es" }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  async function pick(locale: "en" | "es") {
    if (locale === current) return;
    setPending(locale);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className="hidden sm:inline-flex items-center gap-0 rounded-input border border-border bg-surface-2 p-0.5"
      title="Language"
    >
      <Globe className="h-3.5 w-3.5 text-text-subtle ml-1.5" aria-hidden />
      {(["en", "es"] as const).map((loc) => (
        <button
          key={loc}
          type="button"
          disabled={pending !== null}
          onClick={() => pick(loc)}
          className={
            "h-7 px-2 rounded-input text-xs font-medium transition-colors " +
            (current === loc
              ? "bg-brand-50 text-brand-800"
              : "text-text-muted hover:bg-surface")
          }
        >
          {pending === loc ? "…" : LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
