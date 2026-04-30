// One-line employee summary. Used in the Employees list and as a recipient
// row in selection UIs.

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Employee, Shift } from "@/lib/db/schema";
import { ShiftChip } from "./shift-chip";
import { StatusPill } from "./status-pill";
import { MoneyDisplay } from "./money-display";

export type EmployeeRowProps = {
  employee: Employee;
  shift?: Shift | null;
  href?: string;
  className?: string;
};

export function EmployeeRow({ employee, shift, href, className }: EmployeeRowProps) {
  const Wrapper = (href ? Link : "div") as React.ElementType;
  const wrapperProps = href ? { href } : {};
  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "flex items-center justify-between gap-3 rounded-[--radius-card] border border-[--border] bg-[--surface] px-4 py-3 text-sm transition-colors",
        href && "hover:bg-[--surface-2]",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[--text]">{employee.displayName}</span>
          <StatusPill status={employee.status} />
        </div>
        {employee.legalName !== employee.displayName ? (
          <div className="truncate text-xs text-[--text-muted]">
            Legal: {employee.legalName}
          </div>
        ) : null}
        <div className="truncate text-xs text-[--text-muted]">{employee.email}</div>
      </div>
      <div className="flex items-center gap-3">
        {shift ? <ShiftChip name={shift.name} colorHex={shift.colorHex} archived={!!shift.archivedAt} /> : null}
        {employee.hourlyRateCents !== null ? (
          <span className="text-xs text-[--text-muted]">
            <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} />/hr
          </span>
        ) : (
          <span className="text-xs text-[--text-muted]">flat task</span>
        )}
      </div>
    </Wrapper>
  );
}
