import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A section of a home page as one soft glass pane: a small heading with an optional "all" link, then rows separated by white space
 * (one pane per section, nothing nested in a box).
 */
export function ListSection({
  id,
  title,
  action,
  className,
  children,
}: {
  id: string;
  title: string;
  action?: { href: string; label: string };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("glass px-4", className)}>
      <div className="flex items-center justify-between gap-4 py-1.5">
        <h2 id={id} className="min-w-0 text-[1rem] font-semibold">{title}</h2>
        {action ? (
          <Link href={action.href} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            {action.label}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
      <div data-stagger className="pb-1">{children}</div>
    </section>
  );
}

/** One row: primary line, a muted second line, and something small on the right. */
export function ListRow({
  href,
  title,
  subtitle,
  trailing,
  className,
}: {
  href?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const text = (
    <span className="min-w-0 flex-1">
      <span className="block font-medium leading-snug">{title}</span>
      {subtitle ? <span className="mt-0.5 block text-sm text-muted-foreground">{subtitle}</span> : null}
    </span>
  );
  return (
    <div className={cn("flex items-center gap-3 py-3", className)}>
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors hover:text-brand">
          {text}
        </Link>
      ) : (
        text
      )}
      {trailing}
    </div>
  );
}
