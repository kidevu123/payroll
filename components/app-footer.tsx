// Common footer line: version + signature. Read at build time from
// package.json via a Next.js inline env so we don't bundle the JSON.

import * as React from "react";
import { Heart } from "lucide-react";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

export function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={
        "py-4 text-center text-[11px] text-[--text-muted] flex items-center justify-center gap-1.5 " +
        (className ?? "")
      }
    >
      <span className="font-mono">v{VERSION}</span>
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
