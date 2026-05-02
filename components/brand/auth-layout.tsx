// Two-column layout for the unauthenticated routes (login, setup, reset).
// Brand panel on the left (hidden < lg), form pane on the right. The brand
// panel reads from the company Setting so it auto-rebrands when the owner
// uploads a logo or changes the company name. Tailwind v4 @theme tokens drive
// every color so a future palette change ripples without code edits.

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
    <div className="min-h-dvh grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-page">
      {/* Brand panel — single-tone wash derived from brand-700 so a runtime
          accent override (company.brandColorHex on <html>) tints the whole
          panel coherently instead of mixing tenant-overridden brand-700 with
          the @theme default brand-600/800. */}
      <aside
        aria-hidden="true"
        className="hidden lg:flex relative flex-col justify-between p-14 overflow-hidden text-brand-fg"
        style={{
          backgroundImage:
            "radial-gradient(at 25% 15%, color-mix(in oklab, var(--color-brand-700) 100%, white 10%) 0%, transparent 55%), radial-gradient(at 80% 90%, color-mix(in oklab, var(--color-brand-700) 100%, black 25%) 0%, transparent 60%), linear-gradient(135deg, color-mix(in oklab, var(--color-brand-700) 100%, black 18%) 0%, var(--color-brand-700) 55%, color-mix(in oklab, var(--color-brand-700) 100%, black 12%) 100%)",
        }}
      >
        {/* Mesh dot overlay — premium subtle texture. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 60%, white 1px, transparent 1px)",
            backgroundSize: "32px 32px, 48px 48px",
          }}
        />
        {/* Soft glow accents */}
        <div
          aria-hidden="true"
          className="absolute -top-32 -left-32 h-80 w-80 rounded-full blur-3xl opacity-30 pointer-events-none"
          style={{ background: "color-mix(in oklab, var(--color-brand-700) 100%, white 35%)" }}
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full blur-3xl opacity-25 pointer-events-none"
          style={{ background: "color-mix(in oklab, var(--color-brand-700) 100%, black 30%)" }}
        />
        <div className="relative">
          <Wordmark name={company.name} logoPath={company.logoPath} size="2xl" />
        </div>
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            Where every hour is accounted for.
          </p>
          <p className="mt-4 text-sm leading-relaxed opacity-85">
            Punches, payslips, and approvals — all in one place. Built for the
            team that runs the floor, not the spreadsheet.
          </p>
        </div>
        <div className="relative text-xs opacity-70 font-mono tracking-wider uppercase">
          {company.name}
        </div>
      </aside>

      {/* Form pane */}
      <main className="flex flex-col items-center justify-center px-6 py-10 sm:px-10 page-enter">
        <div className="w-full max-w-sm">
          {/* Mobile-only brand row */}
          <div className="mb-10 lg:hidden flex justify-center">
            <Wordmark name={company.name} logoPath={company.logoPath} size="xl" />
          </div>
          {eyebrow ? (
            <p className="text-caption uppercase tracking-wide text-text-subtle mb-2">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-heading font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-2 text-sm text-text-muted">{description}</p>
          ) : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-6 text-xs text-text-subtle">{footer}</div> : null}
        </div>
        <AppFooter className="mt-10" />
      </main>
    </div>
  );
}
