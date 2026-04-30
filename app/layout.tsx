import type { Metadata } from "next";
import "./globals.css";
import { getCompanySettings } from "@/lib/settings/runtime";

export const metadata: Metadata = {
  title: "Payroll",
  description: "Self-hosted payroll and employee operations.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const company = await getCompanySettings();

  // Brand color is owner-controlled (Setting('company.brandColorHex')).
  // We expose it as a CSS custom property so any --brand-* consumer picks it up.
  const brandStyle = company?.brandColorHex
    ? ({ ["--color-brand-700" as string]: company.brandColorHex } as React.CSSProperties)
    : undefined;

  return (
    <html lang={company?.locale?.split("-")[0] ?? "en"} style={brandStyle}>
      <body>{children}</body>
    </html>
  );
}
