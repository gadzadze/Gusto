import type * as React from "react";
import { cn } from "@/lib/utils";

/** Native checkbox with a label; 44px touch target. */
export function Checkbox({
  label,
  hint,
  className,
  id,
  ...props
}: React.ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label htmlFor={id} className={cn("flex min-h-11 cursor-pointer items-start gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-input accent-[var(--ink)]"
        {...props}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-sm text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
