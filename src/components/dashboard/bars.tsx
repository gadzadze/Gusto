import { cn } from "@/lib/utils";

/**
 * Daily values as thin bars (the last `highlight` days in the accent colour). It is a picture of the
 * shape only: `label` is the text alternative, and the exact figure is printed next to it by the page.
 */
export function SparkBars({ values, highlight = 7, label }: { values: number[]; highlight?: number; label: string }) {
  const max = Math.max(...values, 1);
  return (
    <div role="img" aria-label={label} className="flex h-11 items-end gap-0.5">
      {values.map((v, i) => (
        <span
          key={i}
          className={cn("flex-1 rounded-t-sm", v === 0 ? "bg-border" : i >= values.length - highlight ? "bg-brand" : "bg-brand/25")}
          style={{ height: v === 0 ? "2px" : `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** A label, a value and a bar sized against the largest value in its list. */
export function BarRow({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="whitespace-nowrap font-semibold tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }} />
      </div>
    </div>
  );
}
