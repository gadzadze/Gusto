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
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-xl border bg-card", tone === "accent" ? "border-brand/30 bg-brand-soft" : "border-border", className)}
    >
      <header className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-3", tone === "accent" ? "border-brand/20" : "border-border")}>
        <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {count !== undefined ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-brand">{count}</span>
          ) : null}
        </h2>
        {action ? (
          <Link href={action.href} className="whitespace-nowrap text-xs font-medium text-brand underline-offset-2 hover:underline">
            {action.label}
          </Link>
        ) : aside ? (
          <span className="whitespace-nowrap text-xs text-muted-foreground">{aside}</span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

const rowClass = "flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b border-border px-4 py-3 last:border-b-0";

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
