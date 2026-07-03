// Skeleton — a neutral shimmer placeholder used for route loading.tsx files
// and lazy chart fallbacks. Reserves layout space so streamed content and
// code-split widgets swap in without shift (CLS), and gives navigation
// instant visual feedback instead of dead air on a dynamic (uncached) route.
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-card bg-surface-2/70",
        className,
      )}
    />
  );
}

/** Fixed-height placeholder for a lazily-loaded chart. Keeps the card body
 *  the same height as the real chart so nothing jumps when it hydrates. */
export function ChartSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("w-full rounded-input", className)} />;
}

/** Generic route-level loading fallback: a title line, an optional stat row,
 *  and a content block. Rendered by each route's loading.tsx so navigation
 *  shows instant structure instead of dead air while the dynamic (uncached)
 *  server render resolves. Shape is approximate on purpose — it signals
 *  "this page is loading" without pretending to be the final layout. */
export function RouteSkeleton({
  stats = 4,
  withRail = false,
}: {
  stats?: number;
  withRail?: boolean;
}) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56 rounded-input" />
        <Skeleton className="h-4 w-80 max-w-full rounded-input" />
      </div>
      {stats > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : null}
      <div
        className={cn(
          "grid gap-4",
          withRail ? "lg:grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1",
        )}
      >
        <Skeleton className="h-80" />
        {withRail ? <Skeleton className="h-80" /> : null}
      </div>
    </div>
  );
}
