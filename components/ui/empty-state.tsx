// Designed empty state per §9 — Lucide icon in a circle, helpful sentence,
// primary action. Never just "No data."

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center p-10 rounded-[--radius-card] border border-dashed border-[--border] bg-[--surface]",
        className,
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[--surface-2] text-[--text-muted]">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-[--text-muted]">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
