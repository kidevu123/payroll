// Apple touch icon. iOS Safari uses this for "Add to Home Screen" and
// shared-link previews; without it iOS falls back to a screenshot or the
// 32x32 favicon (which is what produced the plain "P" you saw in
// bookmarks). 180x180 is the modern recommendation.

import { ImageResponse } from "next/og";
import { readAsset } from "@/lib/branding/storage";
import { getSetting } from "@/lib/settings/runtime";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, must-revalidate",
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default async function AppleIcon() {
  // Prefer the uploaded favicon when it's a raster format. iOS won't
  // upscale a 32x32 ICO cleanly, but if the admin uploaded a PNG we
  // serve it as-is; iOS handles the resize. SVG also works.
  const asset = await readAsset("favicon");
  if (asset && (asset.ext === ".png" || asset.ext === ".svg")) {
    const mime = asset.ext === ".png" ? "image/png" : "image/svg+xml";
    return new Response(asset.bytes as unknown as BodyInit, {
      headers: { "Content-Type": mime, ...CACHE_HEADERS },
    });
  }
  // Fallback: render a 180x180 brand square with company initials.
  const company = await getSetting("company").catch(() => null);
  const initials = initialsFor(company?.name ?? "Payroll");
  const brand = company?.brandColorHex ?? "#0f766e";
  return new ImageResponse(
    (
      <div
        style={{
          background: brand,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 96,
          fontWeight: 700,
          fontFamily: "sans-serif",
          letterSpacing: -2,
          // Rounded corners to play nicely with iOS's own masking.
          borderRadius: 36,
        }}
      >
        {initials}
      </div>
    ),
    { ...size },
  );
}
