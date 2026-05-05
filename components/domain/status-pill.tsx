// One source of truth for state styling.
// No emoji. Lucide icons only, paired with a text label and a colored chip.

import * as React from "react";
import {
  Circle,
  CircleCheck,
  CircleX,
  Clock,
  Lock,
  Unlock,
  CircleDashed,
  AlertTriangle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type StatusKind =
  // Pay periods
  | "OPEN"
  | "LOCKED"
  | "PAID"
  // Requests
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  // Employees
  | "ACTIVE"
  | "INACTIVE"
  | "TERMINATED"
  // Payroll runs (subset; rest map to one of these visual buckets)
  | "SCHEDULED"
  | "INGESTING"
  | "INGEST_FAILED"
  | "AWAITING_EMPLOYEE_FIXES"
  | "AWAITING_ADMIN_REVIEW"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED";

type Kind = "neutral" | "success" | "warn" | "danger" | "info";

type Style = { kind: Kind; key: string; Icon: React.ComponentType<{ className?: string }> };

const STYLES: Record<StatusKind, Style> = {
  OPEN: { kind: "info", key: "open", Icon: Unlock },
  LOCKED: { kind: "warn", key: "locked", Icon: Lock },
  PAID: { kind: "success", key: "paid", Icon: CircleCheck },

  PENDING: { kind: "warn", key: "pending", Icon: Clock },
  APPROVED: { kind: "success", key: "approved", Icon: CircleCheck },
  REJECTED: { kind: "danger", key: "rejected", Icon: CircleX },

  ACTIVE: { kind: "success", key: "active", Icon: Circle },
  INACTIVE: { kind: "neutral", key: "inactive", Icon: CircleDashed },
  TERMINATED: { kind: "neutral", key: "terminated", Icon: CircleDashed },

  SCHEDULED: { kind: "info", key: "scheduled", Icon: Clock },
  INGESTING: { kind: "info", key: "ingesting", Icon: Clock },
  INGEST_FAILED: { kind: "danger", key: "ingestFailed", Icon: AlertTriangle },
  AWAITING_EMPLOYEE_FIXES: { kind: "warn", key: "awaitingFixes", Icon: AlertTriangle },
  AWAITING_ADMIN_REVIEW: { kind: "warn", key: "awaitingReview", Icon: AlertTriangle },
  PUBLISHED: { kind: "success", key: "published", Icon: CircleCheck },
  FAILED: { kind: "danger", key: "failed", Icon: CircleX },
  CANCELLED: { kind: "neutral", key: "cancelled", Icon: CircleDashed },
};

// Kind classes use a softer hairline border + a subtle inset highlight to
// differentiate the chip from the surface — premium products lean on
// inset shadows over thick borders.
const KIND_CLASSES: Record<Kind, string> = {
  neutral:
    "bg-surface-2 text-text-muted border-border/70 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.4)]",
  success:
    "bg-success-50 text-success-700 border-success-200/80 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.5)]",
  warn:
    "bg-warn-50 text-warn-700 border-warn-200/80 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.5)]",
  danger:
    "bg-danger-50 text-danger-700 border-danger-200/80 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.5)]",
  info:
    "bg-info-50 text-info-700 border-info-200/80 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.5)]",
};

export function StatusPill({
  status,
  className,
}: {
  status: StatusKind;
  className?: string;
}) {
  const t = useTranslations("status");
  const s = STYLES[status];
  const { Icon } = s;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[11px] font-medium tracking-tight antialiased",
        KIND_CLASSES[s.kind],
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(s.key)}
    </span>
  );
}
