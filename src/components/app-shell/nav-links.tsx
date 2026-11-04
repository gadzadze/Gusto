"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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

/** A phone's bottom bar fits five slots. With more items, four show and the rest sit behind "More". */
const BOTTOM_SLOTS = 5;
/** Items whose label has a hyphenated variant under `nav.bar.*` (the longest words). */
const BAR_LABELS = ["suppliers", "products", "orders", "customers", "organizations", "requests"] as const;

export function BottomNav(props: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const all = itemsFor(props.area, props.homeHref, props.showAdminLink);
  const overflow = all.length > BOTTOM_SLOTS;
  const primary = overflow ? all.slice(0, BOTTOM_SLOTS - 1) : all;
  const rest = overflow ? all.slice(BOTTOM_SLOTS - 1) : [];
  const restActive = rest.some((item) => isActive(pathname, item.href, props.area));
  const restBadge = rest.some((item) => (props.badges?.[item.href] ?? 0) > 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const slot = "flex min-h-14 w-full min-w-0 flex-col items-center justify-center gap-1 px-0 text-center text-[10px] font-medium leading-tight";
  // Long words carry soft hyphens in `nav.bar.*`, so on a narrow phone they wrap at a syllable instead of being cut.
  const barLabel = (key: NavItem["labelKey"]) => ((BAR_LABELS as readonly string[]).includes(key) ? t(`bar.${key as (typeof BAR_LABELS)[number]}`) : t(key));
  return (
    <>
      {open ? (
        <>
          <button type="button" aria-label={t("closeMore")} className="fixed inset-0 z-20 cursor-default md:hidden print:hidden" onClick={() => setOpen(false)} />
          <ul
            id="bottom-nav-more"
            className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background p-2 shadow-lg md:hidden print:hidden"
          >
            {rest.map((item) => {
              const active = isActive(pathname, item.href, props.area);
              return (
                <li key={item.href + item.labelKey}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium",
                      active ? "bg-brand-soft text-brand" : "text-foreground",
                    )}
                  >
                    <item.icon aria-hidden className="size-5" />
                    {t(item.labelKey)}
                    <Count n={props.badges?.[item.href] ?? 0} label={String(props.badges?.[item.href] ?? 0)} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <nav
        aria-label={t("menu")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
      >
        <ul className="mx-auto flex max-w-md">
          {primary.map((item) => {
            const active = isActive(pathname, item.href, props.area);
            return (
              <li key={item.href + item.labelKey} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  aria-label={t(item.labelKey)}
                  className={cn(slot, active ? "text-brand" : "text-muted-foreground")}
                >
                  <span className="relative">
                    <item.icon aria-hidden className="size-5" />
                    {(props.badges?.[item.href] ?? 0) > 0 ? (
                      <span aria-hidden className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-brand" />
                    ) : null}
                  </span>
                  <span className="w-full [hyphens:manual]">{barLabel(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
          {overflow ? (
            <li className="min-w-0 flex-1">
              <button
                type="button"
                aria-expanded={open}
                aria-controls="bottom-nav-more"
                onClick={() => setOpen((v) => !v)}
                className={cn(slot, restActive || open ? "text-brand" : "text-muted-foreground")}
              >
                <span className="relative">
                  <Ellipsis aria-hidden className="size-5" />
                  {restBadge ? <span aria-hidden className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-brand" /> : null}
                </span>
                <span className="w-full">{t("more")}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );
}
