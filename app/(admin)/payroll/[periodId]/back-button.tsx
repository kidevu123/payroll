"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Stable back button. Payroll period details are opened from several
 * surfaces (dashboard, reports, payroll, notifications), so browser
 * history can jump to an unrelated workflow. Use the explicit fallback
 * destination every time.
 */
export function PeriodDetailBackButton({
  fallbackHref = "/payroll",
  label = "Back",
}: {
  fallbackHref?: string;
  label?: string;
}) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
      <Link href={fallbackHref}>
        <ArrowLeft className="h-4 w-4" /> {label}
      </Link>
    </Button>
  );
}
