// POST /api/locale — set the user's chosen locale via cookie. Used by the
// LanguageSwitcher in the admin topbar and the employee profile.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n";

const ALLOWED = new Set(["en", "es"]);

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { locale?: string };
  const locale = body.locale ?? "";
  if (!ALLOWED.has(locale)) {
    return NextResponse.json({ error: "invalid locale" }, { status: 400 });
  }
  const c = await cookies();
  c.set(LOCALE_COOKIE, locale, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ ok: true });
}
