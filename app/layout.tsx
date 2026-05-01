import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getCompanySettings } from "@/lib/settings/runtime";
import { resolveLocale, messagesFor } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Payroll",
  description: "Self-hosted payroll and employee operations.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Payroll",
  },
};

// Drives the browser chrome / status bar color. The actual brand hex is
// re-injected per-render via the inline style on <html> (the Next metadata
// API hard-codes the value at build time, so this is the safe default; the
// runtime style override wins for live theming).
export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Every page in this app is auth-gated and reads settings/DB at render time.
// There is nothing to prerender; opt out of static generation globally so
// `next build` does not try to hit the database for missing-at-build-time data.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const company = await getCompanySettings();
  const locale = await resolveLocale();
  const messages = messagesFor(locale);

  // Brand color is owner-controlled (Setting('company.brandColorHex')).
  // We expose it as a CSS custom property so any --brand-* consumer picks it up.
  const brandStyle = company?.brandColorHex
    ? ({ ["--color-brand-700" as string]: company.brandColorHex } as React.CSSProperties)
    : undefined;

  return (
    <html lang={locale} style={brandStyle}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
