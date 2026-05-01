// next-intl request configuration. Required by next-intl 3.x for any
// server-component getTranslations() call. The locale resolution + message
// loading logic lives in lib/i18n; this file is the wiring next-intl
// expects to find via createNextIntlPlugin() in next.config.mjs.

import { getRequestConfig } from "next-intl/server";
import { resolveLocale, messagesFor } from "@/lib/i18n";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: messagesFor(locale),
  };
});
