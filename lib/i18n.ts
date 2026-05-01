// next-intl glue. The app doesn't use locale-prefixed routing — the locale
// is resolved server-side from (in order):
//   1. The signed-in employee's `language` (if linked)
//   2. The Accept-Language header
//   3. "en"
//
// Messages are JSON files under /messages and statically imported below
// so production bundles don't try to load them at runtime via dynamic
// import paths webpack can't analyze.

import { headers } from "next/headers";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type Locale = "en" | "es";

const MESSAGES: Record<Locale, typeof en> = { en, es: es as typeof en };

export async function resolveLocale(): Promise<Locale> {
  // 1. Signed-in employee's language preference.
  try {
    const session = await auth();
    if (session?.user?.employeeId) {
      const [row] = await db
        .select({ lang: employees.language })
        .from(employees)
        .where(eq(employees.id, session.user.employeeId));
      if (row?.lang === "es") return "es";
      if (row?.lang === "en") return "en";
    }
  } catch {
    // Outside a request context or auth not bootable — fall through.
  }
  // 2. Accept-Language header.
  try {
    const h = await headers();
    const al = h.get("accept-language") ?? "";
    if (/^es(?:-|,|;|$)/i.test(al)) return "es";
  } catch {
    // No request context.
  }
  // 3. Default.
  return "en";
}

export function messagesFor(locale: Locale): typeof en {
  return MESSAGES[locale];
}
