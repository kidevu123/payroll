// Dynamic favicon. Reads the uploaded favicon from disk if available,
// otherwise renders an SVG fallback with the company initials. Next.js
// resolves /favicon.ico to whatever this exports.

import { ImageResponse } from "next/og";
import { readAsset } from "@/lib/branding/storage";
import { getSetting } from "@/lib/settings/runtime";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Browsers cache favicons aggressively; we need them to re-check after an
// upload. Short max-age + must-revalidate + ETag-via-content gives us the
// best of both: cheap repeat fetches, but new uploads land within minutes.
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, must-revalidate",
};

export default async function Icon() {
  const asset = await readAsset("favicon");
  if (asset && asset.ext === ".png") {
    return new Response(asset.bytes as unknown as BodyInit, {
      headers: { "Content-Type": "image/png", ...CACHE_HEADERS },
    });
  }
  if (asset) {
    // For .ico/.svg, serve directly with the right MIME.
    const mime = asset.ext === ".ico" ? "image/x-icon" : "image/svg+xml";
    return new Response(asset.bytes as unknown as BodyInit, {
      headers: { "Content-Type": mime, ...CACHE_HEADERS },
    });
  }
  // No favicon uploaded — render initials onto the brand color.
  const company = await getSetting("company").catch(() => null);
  const initials = initialsFor(company?.name ?? "Payroll");
  const brand = company?.brandColorHex ?? "#067049";
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
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "sans-serif",
          letterSpacing: -1,
        }}
      >
        {initials}
      </div>
    ),
    { ...size },
  );
}
