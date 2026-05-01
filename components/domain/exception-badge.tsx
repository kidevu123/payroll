// Semantic icon + tooltip for each MissedPunchIssue type.
// Used in the period review screen and on employee Home cards.

import * as React from "react";
import { AlertCircle, AlertTriangle, Clock3, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Issue = "MISSING_IN" | "MISSING_OUT" | "NO_PUNCH" | "SUSPICIOUS_DURATION";

const META: Record<Issue, { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
  NO_PUNCH: {
    label: "No punch",
    tone: "bg-danger-50 text-danger-700 border-danger-200",
    Icon: MinusCircle,
  },
  MISSING_IN: {
    label: "Missing in",
    tone: "bg-warn-50 text-warn-700 border-warn-200",
    Icon: AlertCircle,
  },
  MISSING_OUT: {
    label: "Missing out",
    tone: "bg-warn-50 text-warn-700 border-warn-200",
    Icon: Clock3,
  },
  SUSPICIOUS_DURATION: {
    label: "Suspicious",
    tone: "bg-warn-50 text-warn-700 border-warn-200",
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
        "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-xs font-medium",
        m.tone,
        className,
      )}
      title={m.label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {m.label}
    </span>
  );
}
