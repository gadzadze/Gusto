"use client";

import { Check, ChevronDown, Plus, ShoppingBasket, Store } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

export type ChipItem = { id: string; href: string; name: string; roleLabel: string; type: "buyer" | "supplier"; current: boolean };

function RoleIcon({ type, className }: { type: ChipItem["type"]; className?: string }) {
  return type === "buyer" ? <ShoppingBasket aria-hidden className={className} /> : <Store aria-hidden className={className} />;
}

/**
 * The phone header's switch for a person with several companies (the brands of a group): a chip showing the current
 * company and its role. It opens a list of every company with its role, and a link to add another. Uses the browser's
 * Popover API (top layer, light dismiss, Escape), like the account menu. The links are plain `<a>`, not next/link:
 * /switch changes the active side, which a prefetch must never do.
 */
export function CompanyChip({ items, navLabel, addHref, addLabel }: { items: ChipItem[]; navLabel: string; addHref: string | null; addLabel: string }) {
  const id = useId();
  const current = items.find((item) => item.current) ?? items[0];
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={`${navLabel}: ${current.name}, ${current.roleLabel}`}
        className="inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-full border border-input bg-surface-2 py-0 pl-1.5 pr-2.5 text-sm font-semibold transition-transform duration-150 active:scale-[0.98] motion-reduce:active:scale-100"
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <RoleIcon type={current.type} className="size-4" />
        </span>
        <span className="min-w-0 truncate">{current.name}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <div
        id={id}
        popover="auto"
        data-motion="menu"
        style={{ transformOrigin: "top left" }}
        className="fixed inset-auto left-3 top-14 m-0 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border bg-surface p-1.5 text-foreground shadow-lg"
      >
        <nav aria-label={navLabel}>
          {items.map((item) => {
            return (
              <a
                key={item.id}
                href={item.href}
                aria-current={item.current ? "true" : undefined}
                className={cn("flex min-h-12 items-center gap-3 rounded-xl px-2.5 text-sm", item.current ? "bg-brand-soft" : "hover:bg-muted")}
              >
                <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-full", item.current ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground")}>
                  <RoleIcon type={item.type} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.roleLabel}</span>
                </span>
                {item.current ? <Check aria-hidden className="size-4 shrink-0 text-brand" /> : null}
              </a>
            );
          })}
        </nav>
        {addHref ? (
          <a href={addHref} className="mt-1 flex min-h-11 items-center gap-3 rounded-xl border-t border-border px-2.5 pt-1 text-sm text-muted-foreground hover:text-foreground">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
              <Plus className="size-4" />
            </span>
            {addLabel}
          </a>
        ) : null}
      </div>
    </>
  );
}
