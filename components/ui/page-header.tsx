import * as React from "react";
import { cn } from "@/lib/utils";

export type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Secondary line — date, period range, provider label, etc. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Employee PWA uses tighter vertical rhythm. */
  density?: "admin" | "employee";
  /** Optional bottom rule for section separation on dense admin pages. */
  rule?: boolean;
};

export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
  density = "admin",
  rule = false,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        rule && "page-header-rule",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1
          className={cn(
            "text-title tracking-tight antialiased text-text",
            density === "employee" && "text-[1.375rem] leading-snug",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="text-body text-text-muted leading-relaxed max-w-2xl">
            {description}
          </p>
        ) : null}
        {meta ? (
          <p className="text-caption text-text-subtle tabular-nums">{meta}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
