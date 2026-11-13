import { Layers, Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

/**
 * For a person who runs several supplier companies (brands): look at this company only, or at all of
 * them together. Links only; the set of companies comes from the server by the person's own memberships.
 */
export async function BrandScope({
  all,
  thisHref,
  allHref,
}: {
  all: boolean;
 
  thisHref: string;
  allHref: string;
}) {
  const t = await getTranslations("brands");
  const items = [
    {
      key: "this",
      href: thisHref,
      active: !all,
      Icon: Store,
      label: t("thisCompany"),
    },
    {
      key: "all",
      href: allHref,
      active: all,
      Icon: Layers,
      label: t("allBrands"),
    },
  ];
  return (
    <div className="space-y-2">
      <nav
        aria-label={t("scope")}
        className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 print:hidden sm:max-w-md"
      >
        {items.map(({ key, href, active, Icon, label }) => (
          <Link
            key={key}
            href={href}
            replace
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium md:min-h-9",
              active
                ? "bg-surface text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden
              className={cn("size-4 shrink-0", active && "text-brand")}
            />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </nav>
      {all ? (
        <p className="text-sm text-muted-foreground print:hidden">
          {t("allHint")}
        </p>
      ) : null}
    </div>
  );
}
