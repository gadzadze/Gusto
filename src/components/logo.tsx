import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-lg font-semibold tracking-tight", className)}>
      <span aria-hidden className="size-3 rounded-[3px] bg-brand" />
      Gusto
    </span>
  );
}
