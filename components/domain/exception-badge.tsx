// Semantic icon + tooltip for each MissedPunchIssue type.
// Used in the period review screen and on employee Home cards.

import * as React from "react";
import { AlertCircle, AlertTriangle, Clock3, MinusCircle, Repeat } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

type Issue =
  | "MISSING_IN"
  | "MISSING_OUT"
  | "UNPAIRED_PUNCH"
  | "NO_PUNCH"
  | "SUSPICIOUS_DURATION"
  | "INVERTED_TIMES";

const META: Record<Issue, { key: string; tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
  NO_PUNCH: {
    key: "noPunch",
    tone: "bg-danger-50 text-danger-700 border-danger-200",
    Icon: MinusCircle,
  },
  MISSING_IN: {
    key: "missingIn",
    tone: "bg-warning-50 text-warning-700 border-warning-200",
    Icon: AlertCircle,
  },
  MISSING_OUT: {
    key: "missingOut",
    tone: "bg-warning-50 text-warning-700 border-warning-200",
    Icon: Clock3,
  },
  UNPAIRED_PUNCH: {
    key: "unpairedPunch",
    tone: "bg-warning-50 text-warning-700 border-warning-200",
    Icon: AlertCircle,
  },
  SUSPICIOUS_DURATION: {
    key: "suspicious",
    tone: "bg-warning-50 text-warning-700 border-warning-200",
    Icon: AlertTriangle,
  },
  INVERTED_TIMES: {
    key: "invertedTimes",
    tone: "bg-danger-50 text-danger-700 border-danger-200",
    Icon: Repeat,
  },
};

export async function ExceptionBadge({
  issue,
  className,
}: {
  issue: Issue;
  className?: string;
}) {
  const t = await getTranslations("exception");
  const m = META[issue];
  const { Icon } = m;
  const label = t(m.key);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-xs font-medium",
        m.tone,
        className,
      )}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </span>
  );
}
