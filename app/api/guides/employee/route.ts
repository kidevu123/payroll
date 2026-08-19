// Employee onboarding guide PDF. Admin-only download. Embeds screenshots
// from /data/employee-guide/<step>.png when present; renders tasteful
// placeholders otherwise. Owner: "build me a quick guide PDF that i can
// send to employees with screen shot" — admin can drop fresh PNGs into
// that dir (or run scripts/screenshots.ts) and re-download to refresh.

import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting } from "@/lib/settings/runtime";

const GUIDE_SCREENSHOT_DIR =
  process.env.EMPLOYEE_GUIDE_SCREENSHOT_DIR ?? "/data/employee-guide";

export async function GET(): Promise<Response> {
  await requireAdmin();
  const company = await getSetting("company");

  // Resolve which screenshots exist on disk. The PDF renderer accepts a
  // null path and renders a placeholder so the download is always
  // shippable — even on a fresh deploy with no screenshots captured yet.
  const tryPath = (name: string): string | null => {
    const abs = join(GUIDE_SCREENSHOT_DIR, name);
    return existsSync(abs) ? abs : null;
  };

  const data = {
    company: {
      name: company.name,
      brandColorHex: company.brandColorHex ?? "#078a54",
      logoPath: null,
    },
    screenshots: {
      install: tryPath("install.png"),
      home: tryPath("home.png"),
      pay: tryPath("pay.png"),
      time: tryPath("time.png"),
      profile: tryPath("profile.png"),
    },
    appUrl: process.env.APP_URL ?? "https://payroll.local",
    generatedAt: new Date().toISOString().slice(0, 10),
  };

  // Same dynamic-import pattern the publish job uses — keeps @react-pdf
  // out of the edge bundle.
  const renderer = (await import(
    /* webpackIgnore: true */ "@react-pdf/renderer"
  )) as typeof import("@react-pdf/renderer");
  // Dynamic-import the precompiled bundle by string-as-expression so
  // webpack doesn't try to resolve it at build time (the file lives at
  // /app/.next/pdf/ on the runtime image, written by the Dockerfile's
  // esbuild step). Mirrors the publish handler's pattern.
  const guideMod = (await Function(
    "p",
    "return import(/* webpackIgnore: true */ p)",
  )("/app/.next/pdf/employee-guide.js")) as typeof import("@/lib/pdf/employee-guide");

  const buf = await renderer.renderToBuffer(guideMod.EmployeeGuide({ data }));
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${company.name.replace(/[^a-z0-9-]+/gi, "-")}-employee-guide.pdf"`,
    },
  });
}
