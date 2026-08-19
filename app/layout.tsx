import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getCompanySettings } from "@/lib/settings/runtime";
import { assetVersion } from "@/lib/branding/storage";
import { resolveLocale, messagesFor } from "@/lib/i18n";
import { DeployVersionGuard } from "@/components/deploy-version-guard";
import { PdfViewerProvider } from "@/components/domain/pdf-viewer";
import { brandRampStyle } from "@/lib/brand/ramp";

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
  themeColor: "#067049",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Every page in this app is auth-gated and reads settings/DB at render time.
// There is nothing to prerender; opt out of static generation globally so
// `next build` does not try to hit the database for missing-at-build-time data.
export const dynamic = "force-dynamic";

// Self-hosted fonts (next/font): downloaded at build, served same-origin as
// immutable assets. Replaces the render-blocking Google Fonts stylesheet that
// added an external round-trip to every cold load — the single biggest
// first-paint cost on the phone. Exposed as CSS variables consumed by the
// --font-sans / --font-mono tokens in globals.css.
//
// ONE UI typeface, everywhere, at every size.
//
// History: headings were set in Bricolage Grotesque (a deliberately irregular
// display face) over Instrument Sans body copy — the two-family pairing read
// as a mismatch on every screen. Collapsing to Instrument Sans alone fixed the
// mismatch but the owner still found it "harsh": Instrument is a tight,
// squarish grotesque whose small apertures get hard at UI sizes.
//
// Inter is the UI-first choice (Linear and most payroll/fintech tools use it):
// open apertures, a tall x-height that stays legible at 12px, and genuine
// tabular figures — which matters here because most of this app is columns of
// money. Mono is kept, but only for real code artifacts.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ui",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
});

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const company = await getCompanySettings();
  const locale = await resolveLocale();
  const messages = messagesFor(locale);

  // Brand color is owner-controlled (Setting('company.brandColorHex')). It
  // seeds the WHOLE ramp — overriding only --color-brand-700 (the previous
  // behavior) left the other nine shades on the compiled-in emerald, so a
  // non-emerald brand color split the UI across two accent families: a CTA in
  // the owner's color with an emerald hover, accent rails in one hue and chip
  // tints in another.
  const brandStyle = brandRampStyle(company?.brandColorHex) as
    | React.CSSProperties
    | undefined;

  return (
    <html
      lang={locale}
      style={brandStyle}
      className={`${inter.variable} ${plexMono.variable}`}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <DeployVersionGuard />
          <PdfViewerProvider>{children}</PdfViewerProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
