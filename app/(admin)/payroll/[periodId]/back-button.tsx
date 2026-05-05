"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Smart back button. Uses `router.back()` when there's prior history
 * (so a user who arrived from /payroll lands back on /payroll, not
 * /reports). Falls back to a static link when the page was opened
 * directly (refresh, deep-link from email/Slack) — defaults to
 * /payroll since that's where most active-work navigation lands.
 */
export function PeriodDetailBackButton({
  fallbackHref = "/payroll",
  label = "Back",
}: {
  fallbackHref?: string;
  label?: string;
}) {
  const router = useRouter();
  const [hasHistory, setHasHistory] = React.useState(false);

  React.useEffect(() => {
    // Only treat history as usable when there's an in-app referrer
    // pointing at this origin. Cross-origin or no-referrer = use the
    // fallback link instead.
    if (typeof window === "undefined") return;
    const ref = document.referrer;
    if (ref && new URL(ref).origin === window.location.origin) {
      setHasHistory(true);
    }
  }, []);

  if (!hasHistory) {
    return (
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
        <Link href={fallbackHref}>
          <ArrowLeft className="h-4 w-4" /> {label}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2 mb-1"
      onClick={() => router.back()}
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </Button>
  );
}
