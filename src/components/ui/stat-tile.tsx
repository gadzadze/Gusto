import type * as React from "react";

/** A dashboard number with its definition printed underneath (no tooltip to find). */
export function StatTile({
  label,
  value,
  note,
  hint,
  children,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 p-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="text-sm tabular-nums text-muted-foreground">{note}</p> : null}
      {children}
      {hint ? <p className="mt-auto pt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
