// Tight table-style row for the admin employees list. ~44px tall so a 30+
// person roster doesn't scroll forever, but still keeps the avatar + name +
// status pill + shift pill + rate columns the owner asked for.
//
// Layout (desktop, single visual row):
//   [avatar] [name + email]            [status] [shift] [rate]    →
//
// On narrow screens the right-hand cluster wraps under the name. The whole
// row stays clickable when `href` is supplied.

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
        "group relative flex min-h-[44px] items-center gap-3 px-4 py-2 text-sm transition-colors",
        href && "cursor-pointer hover:bg-surface-2",
        className,
      )}
    >
      <Avatar name={employee.displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-text">{employee.displayName}</span>
        </div>
        <div className="truncate text-xs text-text-subtle">{employee.email}</div>
      </div>
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <StatusPill status={employee.status} />
        {shift ? (
          <ShiftChip name={shift.name} colorHex={shift.colorHex} archived={!!shift.archivedAt} />
        ) : (
          <span className="text-[11px] text-text-subtle italic w-16 text-center">no shift</span>
        )}
        <div className="w-24 text-right">
          {employee.hourlyRateCents !== null ? (
            <span className="text-xs text-text-muted tabular-nums">
              <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} /> {rateSuffix}
            </span>
          ) : (
            <span className="text-xs text-text-subtle">{isFlatTask ? "per task" : "—"}</span>
          )}
        </div>
        {href ? (
          <ChevronRight className="h-4 w-4 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        ) : null}
      </div>
      {/* Mobile-only secondary line: status + rate stacked under the name */}
      <div className="md:hidden flex items-center gap-2 shrink-0">
        <StatusPill status={employee.status} />
        {employee.hourlyRateCents !== null ? (
          <span className="text-xs text-text-muted tabular-nums shrink-0">
            <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} />
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}
