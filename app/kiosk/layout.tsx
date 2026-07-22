// Warehouse kiosk shell. Deliberately outside the admin/employee shells:
// forced light, maximum contrast (outdoor sunlight), display-scale type,
// no navigation chrome. Every interactive element is thumb-sized.

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Kiosk",
  robots: { index: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-neutral-900 antialiased [color-scheme:light]">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-6">
        {children}
      </div>
    </div>
  );
}
