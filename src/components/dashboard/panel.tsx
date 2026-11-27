import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { FreshRow } from "@/components/motion/fresh-row";
import { cn } from "@/lib/utils";

/** A titled block of a dashboard: header with an optional count and link, then rows. */
export function Panel({
  id,
  title,
  count,
  action,
  aside,
  tone = "plain",
  className,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  action?: { href: string; label: string };
  /** Small muted text on the right when there is no link. */
  aside?: string;
  tone?: "plain" | "accent";
  className?: string;
  children: React.ReactNode;
}) {
  // A soft glass pane: heading and "All" link inside it, one hairline above the rows. Only the "accent" tone (something due today)
  // swaps the tint for the soft burgundy fill.
  const accent = tone === "accent";
  return (
    <section aria-labelledby={id} className={cn("glass px-4", accent && "border-brand/30 bg-brand-soft", className)}>
      <header className="flex items-center justify-between gap-3 py-3">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-[1rem] font-semibold">
          {title}
          {count !== undefined ? (
            <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-brand">{count}</span>
          ) : null}
        </h2>
        {action ? (
          <Link href={action.href} className="inline-flex min-h-11 items-center gap-0.5 whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground">
            {action.label}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : aside ? (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{aside}</span>
        ) : null}
      </header>
      <div data-stagger>{children}</div>
    </section>
  );
}

const rowClass = "flex flex-wrap items-center gap-x-3.5 gap-y-2.5 py-3";

/** `freshId`: a row that can arrive while the page is open (a new order); it gets a short highlight when it does. */
export function PanelRow({ className, freshId, children }: { className?: string; freshId?: string; children: React.ReactNode }) {
  if (freshId) {
    return (
      <FreshRow id={freshId} className={cn(rowClass, className)}>
        {children}
      </FreshRow>
    );
  }
  return <div className={cn(rowClass, className)}>{children}</div>;
}
