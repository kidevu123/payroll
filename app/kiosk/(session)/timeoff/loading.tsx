import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6" aria-busy="true">
      <Skeleton className="h-9 w-48 rounded-input" />
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
    </main>
  );
}
