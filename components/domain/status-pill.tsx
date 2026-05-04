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

type Style = { kind: Kind; label: string; Icon: React.ComponentType<{ className?: string }> };

const STYLES: Record<StatusKind, Style> = {
  OPEN: { kind: "info", label: "Open", Icon: Unlock },
  LOCKED: { kind: "warn", label: "Locked", Icon: Lock },
  PAID: { kind: "success", label: "Paid", Icon: CircleCheck },

  PENDING: { kind: "warn", label: "Pending", Icon: Clock },
  APPROVED: { kind: "success", label: "Approved", Icon: CircleCheck },
  REJECTED: { kind: "danger", label: "Rejected", Icon: CircleX },

  ACTIVE: { kind: "success", label: "Active", Icon: Circle },
  INACTIVE: { kind: "neutral", label: "Inactive", Icon: CircleDashed },
  TERMINATED: { kind: "neutral", label: "Terminated", Icon: CircleDashed },

  SCHEDULED: { kind: "info", label: "Scheduled", Icon: Clock },
  INGESTING: { kind: "info", label: "Ingesting", Icon: Clock },
  INGEST_FAILED: { kind: "danger", label: "Ingest failed", Icon: AlertTriangle },
  AWAITING_EMPLOYEE_FIXES: { kind: "warn", label: "Awaiting fixes", Icon: AlertTriangle },
  AWAITING_ADMIN_REVIEW: { kind: "warn", label: "Awaiting review", Icon: AlertTriangle },
  PUBLISHED: { kind: "success", label: "Published", Icon: CircleCheck },
  FAILED: { kind: "danger", label: "Failed", Icon: CircleX },
  CANCELLED: { kind: "neutral", label: "Cancelled", Icon: CircleDashed },
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
      {s.label}
    </span>
  );
}
