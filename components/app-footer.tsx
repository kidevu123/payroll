// Common footer line: short commit SHA + build timestamp + signature.
// The package.json version was historically also shown, but the team
// stopped bumping it consistently — so the SHA + UTC build timestamp
// are now the authoritative "what's running" marker. VERSION stays
// exported for any other consumer (PDFs etc.) but is not displayed.
//
// SHA / BUILD_AT injected at build time via NEXT_PUBLIC_GIT_SHA /
// NEXT_PUBLIC_BUILD_AT (Dockerfile build stage).

import * as React from "react";
import { Heart } from "lucide-react";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;
const SHA = process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev";
const BUILD_AT_RAW = process.env.NEXT_PUBLIC_BUILD_AT ?? "";

/**
 * Render the build-time ISO (e.g. "2026-05-02T14:23:45Z") as a compact
 * "2026-05-02 14:23 UTC" string. Falls back to the raw value if the
 * input doesn't match the expected shape.
 */
function formatBuildAt(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return iso;
  return `${m[1]} ${m[2]} UTC`;
}

const BUILD_AT_DISPLAY = formatBuildAt(BUILD_AT_RAW);

export function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={
        "py-4 text-center text-[11px] text-text-muted flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 " +
        (className ?? "")
      }
    >
      <a
        href={`https://github.com/kidevu123/payroll/commit/${process.env.NEXT_PUBLIC_GIT_SHA ?? ""}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono hover:text-text"
        title="View commit on GitHub"
      >
        {SHA}
      </a>
      {BUILD_AT_DISPLAY && (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-mono" title={BUILD_AT_RAW}>
            {BUILD_AT_DISPLAY}
          </span>
        </>
      )}
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
