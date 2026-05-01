// Common footer line: version + commit SHA + signature. Both values are
// captured at build time:
//   • VERSION → package.json
//   • SHA / BUILD_AT → injected via NEXT_PUBLIC_GIT_SHA / NEXT_PUBLIC_BUILD_AT
//     env (set by the Dockerfile build stage). The fallbacks ensure local
//     dev still renders something sensible.

import * as React from "react";
import { Heart } from "lucide-react";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;
const SHA = process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev";
const BUILD_AT = process.env.NEXT_PUBLIC_BUILD_AT ?? "";

export function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={
        "py-4 text-center text-[11px] text-text-muted flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 " +
        (className ?? "")
      }
    >
      <span className="font-mono">v{VERSION}</span>
      <span aria-hidden="true">·</span>
      <span className="font-mono" title={BUILD_AT ? `Built ${BUILD_AT}` : undefined}>
        {SHA}
      </span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        Made with{" "}
        <Heart className="h-3 w-3 fill-current text-rose-500" aria-label="love" />{" "}
        by your haute tech team
      </span>
    </footer>
  );
}

export const APP_VERSION = VERSION;
