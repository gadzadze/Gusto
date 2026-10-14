"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, ADMIN_LINK, type Area, type NavItem } from "./nav";

// Icons can't cross the server→client boundary as props, so the client side
// rebuilds the list from the area name.
function itemsFor(area: Area, homeHref: string | null, showAdminLink: boolean): NavItem[] {
  const items = [...NAV_ITEMS[area]];
  if (area === "admin" && homeHref) {
    items.push({ ...NAV_ITEMS[homeHref === "/buyer" ? "buyer" : "supplier"][0] });
  }
  if (area !== "admin" && showAdminLink) items.push(ADMIN_LINK);
  return items;
}

function isActive(pathname: string, href: string, area: Area): boolean {
  const areaRoot = `/${area}`;
  if (href === areaRoot) return pathname === areaRoot;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** `badges` maps a nav href to a count shown next to it (e.g. suppliers waiting for approval). */
type Props = { area: Area; homeHref: string | null; showAdminLink: boolean; badges?: Record<string, number> };

function Count({ n, label }: { n: number; label: string }) {
  if (n <= 0) return null;
  return (
    <span
      aria-label={label}
      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold leading-5 text-brand-foreground tabular-nums"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function SidebarNav(props: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("menu")} className="flex flex-col gap-1">
      {itemsFor(props.area, props.homeHref, props.showAdminLink).map((item) => {
        const active = isActive(pathname, item.href, props.area);
        return (
          <Link
            key={item.href + item.labelKey}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
              active ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon aria-hidden className="size-4" />
            {t(item.labelKey)}
            <Count n={props.badges?.[item.href] ?? 0} label={String(props.badges?.[item.href] ?? 0)} />
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav(props: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("menu")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {itemsFor(props.area, props.homeHref, props.showAdminLink).map((item) => {
          const active = isActive(pathname, item.href, props.area);
          return (
            <li key={item.href + item.labelKey} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-center text-[11px] font-medium leading-tight",
                  active ? "text-brand" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <item.icon aria-hidden className="size-5" />
                  {(props.badges?.[item.href] ?? 0) > 0 ? (
                    <span aria-hidden className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-brand" />
                  ) : null}
                </span>
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
