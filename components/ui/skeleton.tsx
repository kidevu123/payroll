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

/** Phone-shaped loading fallback for the employee PWA tabs: greeting line +
 *  stacked cards inside the same main padding the real pages use. Every tab
 *  tap paints this instantly instead of freezing on the previous screen
 *  while the dynamic server render resolves. */
export function EmployeeRouteSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <main
      className="px-4 py-6 sm:px-6 sm:py-8 space-y-4"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-44 rounded-input" />
        <Skeleton className="h-4 w-64 max-w-full rounded-input" />
      </div>
      {Array.from({ length: cards }).map((_, i) => (
        <Skeleton key={i} className={i === 0 ? "h-32" : "h-44"} />
      ))}
    </main>
  );
}

/** Generic route-level loading fallback (admin): title, stat row, content. */
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
