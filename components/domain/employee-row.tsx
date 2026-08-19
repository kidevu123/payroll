// Table-style row for the admin employees list.
//
// Layout (desktop):
//   [avatar] [name + email] | [status] | [shift] | [rate] | →
//
// The columns are a real grid shared with EmployeeListHeader below, so the
// values line up under their labels. This used to be `flex justify-between`
// with a pseudo-column (`w-24 text-right`) for the rate: on a wide monitor the
// name sat at the far left and the chips at the far right with several hundred
// pixels of dead space between them, and nothing lined up with anything.
//
// On narrow screens the row collapses to name/email with a compact status +
// rate cluster underneath. The whole row stays clickable when `href` is given.

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Employee, Shift } from "@/lib/db/schema";
import { ShiftChip } from "./shift-chip";
import { StatusPill } from "./status-pill";
import { MoneyDisplay } from "./money-display";
import { Avatar } from "./avatar";
import { MicroLabel } from "@/components/ui/typography";

/** Shared column template. Header and rows must both use it. */
const LIST_GRID =
  "md:grid md:grid-cols-[minmax(0,1fr)_7rem_9rem_7.5rem_1.25rem] md:items-center md:gap-4";

export type EmployeeRowProps = {
  employee: Employee;
  shift?: Shift | null;
  href?: string;
  className?: string;
};

/** Column labels for the employees list. Desktop only; rows stack below md. */
export function EmployeeListHeader({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "hidden px-4 py-2 text-text-subtle",
        LIST_GRID,
        "md:grid",
        className,
      )}
    >
      <MicroLabel>Employee</MicroLabel>
      <MicroLabel>Status</MicroLabel>
      <MicroLabel>Shift</MicroLabel>
      <MicroLabel className="text-right">Rate</MicroLabel>
      <span aria-hidden />
    </div>
  );
}

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
        LIST_GRID,
        href && "cursor-pointer hover:bg-surface-2/40",
        className,
      )}
    >
      {/* 1 · Identity */}
      <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
        <Avatar name={employee.displayName} size="sm" />
        <div className="min-w-0">
          <div className="truncate font-medium text-text">
            {employee.displayName}
          </div>
          <div className="truncate text-caption text-text-subtle">
            {employee.email}
          </div>
        </div>
      </div>

      {/* 2 · Status */}
      <div className="hidden md:block">
        <StatusPill status={employee.status} />
      </div>

      {/* 3 · Shift */}
      <div className="hidden min-w-0 md:block">
        {shift ? (
          <ShiftChip
            name={shift.name}
            colorHex={shift.colorHex}
            archived={!!shift.archivedAt}
          />
        ) : (
          <span className="text-caption italic text-text-subtle">no shift</span>
        )}
      </div>

      {/* 4 · Rate */}
      <div className="hidden text-right tabular-nums md:block">
        {employee.hourlyRateCents !== null ? (
          <span className="text-caption text-text-muted">
            <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} />{" "}
            {rateSuffix}
          </span>
        ) : (
          <span className="text-caption text-text-subtle">
            {isFlatTask ? "per task" : "—"}
          </span>
        )}
      </div>

      {/* 5 · Affordance */}
      <div className="hidden md:block">
        {href ? (
          <ChevronRight
            className="h-4 w-4 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {/* Mobile-only cluster: status + rate beside the name */}
      <div className="flex shrink-0 items-center gap-2 md:hidden">
        <StatusPill status={employee.status} />
        {employee.hourlyRateCents !== null ? (
          <span className="shrink-0 text-caption tabular-nums text-text-muted">
            <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} />
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}
