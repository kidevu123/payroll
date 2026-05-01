// Dynamic PWA manifest. Reads company.brandColorHex + name + locale from
// settings so a fresh deploy picks up the owner's branding without a
// rebuild.

import type { MetadataRoute } from "next";
import { getSetting } from "@/lib/settings/runtime";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const company = await getSetting("company").catch(() => null);
  const name = company?.name ?? "Payroll";
  const themeColor = company?.brandColorHex ?? "#0f766e";
  const lang = company?.locale?.split("-")[0] ?? "en";
  return {
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: "Self-hosted payroll and employee operations.",
    start_url: "/me/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: themeColor,
    background_color: "#ffffff",
    lang,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
