// One session lookup per request.
//
// auth() decodes the cookie and, by design, re-reads the user row every time
// so role / disabled changes apply without a re-login. A single page render
// called it from the layout, the page, each guard and the locale resolver:
// four to six identical user queries per request, on every screen. React's
// cache() memoises it for the lifetime of one server request, so the checks
// stay exactly as fresh as before and run once.
import { cache } from "react";
import { auth } from "@/lib/auth";

export const getRequestSession = cache(async () => auth());
