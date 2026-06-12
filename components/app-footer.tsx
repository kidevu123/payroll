// Common footer line: short commit SHA + server time + signature.
// The package.json version was historically also shown, but the team
// stopped bumping it consistently, so the SHA is the authoritative
// "what's running" marker. VERSION stays exported for any other consumer
// (PDFs etc.) but is not displayed.
//
// SHA / BUILD_AT injected at build time via NEXT_PUBLIC_GIT_SHA /
// NEXT_PUBLIC_BUILD_AT (Dockerfile build stage).

import * as React from "react";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;
const SHA = process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev";
const DEFAULT_TIMEZONE = "America/New_York";

function formatServerTime(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
  } catch {
    return date.toISOString();
  }
}

export function AppFooter({
  className,
  timezone = DEFAULT_TIMEZONE,
}: {
  className?: string;
  timezone?: string | null;
}) {
  const tz = timezone || DEFAULT_TIMEZONE;
  const serverTime = formatServerTime(new Date(), tz);
  return (
    <footer
      className={
        "no-print py-4 text-center text-[11px] text-text-muted flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 " +
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
      <span aria-hidden="true">·</span>
      <span className="font-mono">
        Server time {serverTime}
      </span>
      <span aria-hidden="true">·</span>
      <span>Made by your haute tech team</span>
    </footer>
  );
}

export const APP_VERSION = VERSION;
