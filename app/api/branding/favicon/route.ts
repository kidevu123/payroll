// Serves the uploaded favicon. Falls through to a 404 when no favicon has
// been uploaded — the head links in app/layout.tsx fall back to the
// public/favicon.ico in that case. Also wired to /favicon.ico via a
// dynamic route so browsers that ignore the <link> still get the right asset.

import { NextResponse } from "next/server";
import { readAsset } from "@/lib/branding/storage";

const MIME: Record<string, string> = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export async function GET(): Promise<Response> {
  const asset = await readAsset("favicon");
  if (!asset) return new NextResponse("not found", { status: 404 });
  return new NextResponse(asset.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": MIME[asset.ext] ?? "image/x-icon",
      "Cache-Control": "public, max-age=300",
    },
  });
}
