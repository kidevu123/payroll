// One-line employee summary with an avatar circle (initials fallback). Used
// in the Employees list and as a recipient row in selection UIs.
//
// We don't store photos, so the avatar is always initials in a brand-tinted
// circle. The chip is small but it gives the row visual weight and breaks the
// monotony of long left-aligned text columns.

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Employee, Shift } from "@/lib/db/schema";
import { ShiftChip } from "./shift-chip";
import { StatusPill } from "./status-pill";
import { MoneyDisplay } from "./money-display";
import { Avatar } from "./avatar";

export type EmployeeRowProps = {
  employee: Employee;
  shift?: Shift | null;
  href?: string;
  className?: string;
};

export function EmployeeRow({ employee, shift, href, className }: EmployeeRowProps) {
  const Wrapper = (href ? Link : "div") as React.ElementType;
  const wrapperProps = href ? { href } : {};
  const isFlatTask = employee.payType === "FLAT_TASK";
  const rateSuffix = isFlatTask ? "per task" : "/hr";
  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "group flex items-center gap-4 rounded-card border border-border bg-surface-2 px-4 py-3 text-sm shadow-sm transition-all",
        href && "hover:border-border-strong hover:shadow-card-hover hover:bg-surface-3",
        className,
      )}
    >
      <Avatar name={employee.displayName} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-text">{employee.displayName}</span>
          <StatusPill status={employee.status} />
        </div>
        {employee.legalName !== employee.displayName ? (
          <div className="truncate text-xs text-text-muted">
            Legal: {employee.legalName}
          </div>
        ) : null}
        <div className="truncate text-xs text-text-subtle">{employee.email}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {shift ? <ShiftChip name={shift.name} colorHex={shift.colorHex} archived={!!shift.archivedAt} /> : null}
        {employee.hourlyRateCents !== null ? (
          <span className="text-xs text-text-muted font-mono tabular-nums text-right">
            <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} /> {rateSuffix}
          </span>
        ) : (
          <span className="text-xs text-text-subtle">{isFlatTask ? "per task" : "—"}</span>
        )}
      </div>
    </Wrapper>
  );
}
