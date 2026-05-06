// Single-card auth layout for unauthenticated routes (login, setup, reset).
// One elevated card centered on the ambient page background (the brand-tinted
// radial wash already lives in app/globals.css). Logo sits at the top of the
// card, then a refined heading + helper text, then the form. The footer is
// pinned to the bottom of the viewport. Tailwind v4 @theme tokens drive every
// color so a future palette change ripples through without code edits.

import { getSetting } from "@/lib/settings/runtime";
import { AppFooter } from "@/components/app-footer";
import { Wordmark } from "./wordmark";

const FALLBACK = { name: "Payroll", logoPath: null as string | null };

async function loadCompany() {
  const c = await getSetting("company").catch(() => null);
  if (!c) return FALLBACK;
  return { name: c.name || FALLBACK.name, logoPath: c.logoPath };
}

export async function AuthLayout({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const company = await loadCompany();
  return (
    <div className="min-h-dvh flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:px-6 page-enter">
        <div className="w-full max-w-[420px]">
          {/* Elevated card — soft hairline + premium shadow. The ambient
              brand-tinted page background shows through around the card. */}
          <div
            className="rounded-card bg-surface border border-border/70 shadow-card-strong px-8 pt-8 pb-7 sm:px-10 sm:pt-10 sm:pb-8"
          >
            <div className="flex flex-col items-center text-center">
              {/* When the company has uploaded a logo, that image already
                  carries the wordmark — don't repeat the name next to it.
                  Initials-only fallback (no logo) keeps the name so the
                  shell still tells you what the app is. */}
              <Wordmark
                name={company.name}
                logoPath={company.logoPath}
                size="lg"
                showName={!company.logoPath}
              />
            </div>
            <div className="mt-7 text-center">
              {eyebrow ? (
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-subtle">
                  {eyebrow}
                </p>
              ) : null}
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight antialiased text-text">
                {title}
              </h1>
              {description ? (
                <p className="mt-2 text-sm leading-relaxed text-text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="mt-7">{children}</div>
            {footer ? (
              <div className="mt-6 pt-5 border-t border-border/60 text-center text-xs text-text-muted">
                {footer}
              </div>
            ) : null}
          </div>
          <p className="mt-6 text-center text-[11px] text-text-subtle">
            {company.name} · Where every hour is accounted for.
          </p>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
