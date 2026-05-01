// Dynamic PWA manifest. Reads company.brandColorHex + name + locale from
// settings so a fresh deploy picks up the owner's branding without a
// rebuild. Icons resolve through /api/branding/icon/[size] which falls
// back to a generated initials SVG when no logo has been uploaded.

import type { MetadataRoute } from "next";
import { getSetting } from "@/lib/settings/runtime";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const company = await getSetting("company").catch(() => null);
  const name = company?.name ?? "Payroll";
  const themeColor = company?.brandColorHex ?? "#0f766e";
  const lang = company?.locale?.split("-")[0] ?? "en";
  const v = company?.iconsGeneratedAt ?? "default";
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
        src: `/api/branding/icon/192?v=${v}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/api/branding/icon/512?v=${v}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/api/branding/icon/maskable-512?v=${v}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
