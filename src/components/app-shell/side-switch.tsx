import { ShoppingBasket, Store } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

export type Side = { orgId: string; type: "buyer" | "supplier"; current: boolean };

/**
 * A person with both a buyer and a supplier side chooses which one they act as. Plain links
 * to /switch, which only accepts the person's own organizations.
 */
export async function SideSwitch({ sides, compact }: { sides: Side[]; compact?: boolean }) {
  const t = await getTranslations();
  if (sides.length < 2) return null;
  return (
    <nav aria-label={t("nav.sideSwitch")} className="grid w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1">
      {sides.map((side) => {
        const Icon = side.type === "buyer" ? ShoppingBasket : Store;
        return (
          // A plain link, not next/link: /switch changes the active side, which a prefetch must never do.
          <a
            key={side.orgId}
            href={`/switch?org=${side.orgId}`}
            aria-current={side.current ? "true" : undefined}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              compact ? "min-h-11" : "min-h-9 md:min-h-8",
              side.current
                ? "bg-surface text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden className={cn("size-4 shrink-0", side.current && "text-brand")} />
            <span className="truncate">{t(`roles.${side.type}`)}</span>
          </a>
        );
      })}
    </nav>
  );
}
