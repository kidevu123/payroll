import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getCompanySettings } from "@/lib/settings/runtime";
import { assetVersion } from "@/lib/branding/storage";
import { resolveLocale, messagesFor } from "@/lib/i18n";
import { DeployVersionGuard } from "@/components/deploy-version-guard";

/**
 * Cache-busted icon links keyed off the uploaded favicon's mtime. Forces
 * browsers to fetch a fresh URL after upload — more reliable than
 * Cache-Control headers (mobile browsers ignore them for favicons).
 */
export async function generateMetadata(): Promise<Metadata> {
  const v = await assetVersion("favicon");
  return {
    title: "Milo",
    description: "Self-hosted payroll and employee operations.",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      // Owner-set short name for the iOS Add-to-Home-Screen prompt; this is
      // what the springboard tile reads. Long form lives in the manifest.
      title: "Milo",
    },
    icons: {
      icon: [{ url: `/icon?v=${v}`, sizes: "any" }],
      apple: [{ url: `/apple-icon?v=${v}`, sizes: "180x180" }],
      shortcut: [{ url: `/icon?v=${v}` }],
    },
  };
}

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <DeployVersionGuard />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
