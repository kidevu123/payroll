// POST /api/locale — set the user's chosen locale via cookie. Used by the
// LanguageSwitcher in the admin topbar and the employee profile.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n";

const ALLOWED = new Set(["en", "es"]);

export async function POST(req: Request): Promise<Response> {
  // Same-origin guard: a cross-origin form-POST can flip a logged-in
  // user's locale otherwise. JSON body forces a preflight on cross-origin
  // browsers, but the Origin/Referer check is the explicit defense.
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  const expectedHost = host;
  const fromOrigin = origin ? new URL(origin).host : null;
  const fromReferer = referer ? new URL(referer).host : null;
  if (
    expectedHost &&
    ((fromOrigin && fromOrigin !== expectedHost) ||
      (fromReferer && fromReferer !== expectedHost))
  ) {
    return NextResponse.json({ error: "cross-origin denied" }, { status: 403 });
  }

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
