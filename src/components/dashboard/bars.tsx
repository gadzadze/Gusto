/** A label, a value and a bar sized against the largest value in its list. */
export function BarRow({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  return (
    <div className="py-2.5">
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
