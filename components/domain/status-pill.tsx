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

const KIND_CLASSES: Record<Kind, string> = {
  neutral: "bg-[--surface-2] text-[--text] border-[--border]",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-700 border-red-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
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
        "inline-flex items-center gap-1 rounded-[--radius-chip] border px-2 py-0.5 text-xs font-medium",
        KIND_CLASSES[s.kind],
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {s.label}
    </span>
  );
}
