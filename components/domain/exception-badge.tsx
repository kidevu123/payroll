// Semantic icon + tooltip for each MissedPunchIssue type.
// Used in the period review screen and on employee Home cards.

import * as React from "react";
import { AlertCircle, AlertTriangle, Clock3, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Issue = "MISSING_IN" | "MISSING_OUT" | "NO_PUNCH" | "SUSPICIOUS_DURATION";

const META: Record<Issue, { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
  NO_PUNCH: {
    label: "No punch",
    tone: "bg-red-50 text-red-700 border-red-200",
    Icon: MinusCircle,
  },
  MISSING_IN: {
    label: "Missing in",
    tone: "bg-amber-50 text-amber-800 border-amber-200",
    Icon: AlertCircle,
  },
  MISSING_OUT: {
    label: "Missing out",
    tone: "bg-amber-50 text-amber-800 border-amber-200",
    Icon: Clock3,
  },
  SUSPICIOUS_DURATION: {
    label: "Suspicious",
    tone: "bg-yellow-50 text-yellow-800 border-yellow-200",
    Icon: AlertTriangle,
  },
};

export function ExceptionBadge({
  issue,
  className,
}: {
  issue: Issue;
  className?: string;
}) {
  const m = META[issue];
  const { Icon } = m;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[--radius-chip] border px-2 py-0.5 text-xs font-medium",
        m.tone,
        className,
      )}
      title={m.label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {m.label}
    </span>
  );
}
