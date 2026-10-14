import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** An inline banner for account-level states (e.g. "awaiting review"). */
export function Notice({
  icon: Icon,
  title,
  children,
  tone = "neutral",
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  tone?: "neutral" | "amber";
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex gap-3 rounded-xl border p-4",
        tone === "amber"
          ? "border-[var(--status-amber-fg)]/20 bg-[var(--status-amber-bg)] text-[var(--status-amber-fg)]"
          : "border-border bg-muted",
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {children ? <div className="text-sm opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
