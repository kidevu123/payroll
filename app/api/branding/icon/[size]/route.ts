// Serves PWA icons. When the owner has uploaded a logo, the upload action
// runs sharp to write icon-{192,512,maskable-512}.png under
// /data/uploads/branding/icons/ — those are streamed here. When no logo
// has been uploaded yet, falls back to a generated SVG with the company
// initials on a brand-colored square so the manifest never 404s.

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import {
  fallbackIconSvg,
  findIconPath,
} from "@/lib/branding/storage";
import { getSetting } from "@/lib/settings/runtime";

const ALLOWED_SIZES = ["192", "512", "maskable-512"] as const;
type AllowedSize = (typeof ALLOWED_SIZES)[number];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ size: string }> },
): Promise<Response> {
  const { size } = await context.params;
  if (!ALLOWED_SIZES.includes(size as AllowedSize)) {
    return new NextResponse("invalid size", { status: 400 });
  }
  const path = await findIconPath(size as AllowedSize);
  if (path) {
    const bytes = await readFile(path);
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }
  // Fallback SVG — sized to match the requested PWA icon dimension.
  const company = await getSetting("company").catch(() => null);
  const fallbackSize = size === "192" ? 192 : 512;
  const svg = fallbackIconSvg(
    initialsFor(company?.name ?? "Payroll"),
    company?.brandColorHex ?? "#0f766e",
    fallbackSize,
  );
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
    },
  });
}
