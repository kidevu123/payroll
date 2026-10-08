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
import { initialsFor } from "@/lib/text/initials";

const ALLOWED_SIZES = ["192", "512", "maskable-512"] as const;
type AllowedSize = (typeof ALLOWED_SIZES)[number];

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
    initialsFor(company?.name ?? "Payroll", "P"),
    company?.brandColorHex ?? "#067049",
    fallbackSize,
  );
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
    },
  });
}
