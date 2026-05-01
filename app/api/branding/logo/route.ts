// Serves the uploaded company logo. Public — the wordmark renders in the
// login page brand panel before authentication.

import { NextResponse } from "next/server";
import { readAsset } from "@/lib/branding/storage";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
};

export async function GET(): Promise<Response> {
  const asset = await readAsset("logo");
  if (!asset) return new NextResponse("not found", { status: 404 });
  return new NextResponse(asset.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": MIME[asset.ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=300",
    },
  });
}
