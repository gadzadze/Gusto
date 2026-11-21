import { cn } from "@/lib/utils";

/**
 * A green circle with a check that draws itself once (see `.success-check` in globals.css; no animation under
 * reduced motion). Used for the few moments worth marking: an order sent, an order confirmed.
 */
export function SuccessMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--status-green-fg)]/12 text-[var(--status-green-fg)]", className)}>
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path className="success-check" d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" />
      </svg>
    </span>
  );
}
