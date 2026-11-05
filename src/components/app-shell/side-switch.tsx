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
    <nav aria-label={t("nav.sideSwitch")} className={cn("flex gap-1 rounded-lg bg-muted p-1", compact ? "" : "w-full")}>
      {sides.map((side) => (
        // A plain link, not next/link: /switch changes the active side, which a prefetch must never do.
        <a
          key={side.orgId}
          href={`/switch?org=${side.orgId}`}
          aria-current={side.current ? "true" : undefined}
          className={cn(
            "inline-flex min-h-9 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium md:min-h-8",
            compact && "min-h-11 px-2 text-xs md:min-h-11",
            side.current ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`roles.${side.type}`)}
        </a>
      ))}
    </nav>
  );
}
