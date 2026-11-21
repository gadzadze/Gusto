import { Skeleton } from "@/components/ui/skeleton";

// What a dashboard looks like before its data arrives: the same panels in the same places, so nothing jumps when it
// loads. Decorative only (Skeleton is aria-hidden); the page header above them is already real.

function PanelSkeleton({ rows, tall }: { rows: number; tall?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-16" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className={tall ? "h-9 w-20" : "h-8 w-16"} />
        </div>
      ))}
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

/** Supplier and buyer homes: a wide column of lists and a narrow column of figures. */
export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[1.55fr_1fr]" aria-hidden>
      <div className="space-y-5">
        <PanelSkeleton rows={3} tall />
        <PanelSkeleton rows={3} />
      </div>
      <div className="space-y-5">
        <StatSkeleton />
        <PanelSkeleton rows={3} />
      </div>
    </div>
  );
}
