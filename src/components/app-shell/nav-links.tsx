"use client";

import { ChevronRight, Ellipsis, ShieldCheck } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ChangePulse } from "@/components/motion/change-pulse";
import { useNavBadges } from "./nav-badges";
import { NAV_ITEMS, ADMIN_LINK, type Area, type NavItem } from "./nav";

// Icons can't cross the server→client boundary as props, so the client side
// rebuilds the list from the area name.
export function itemsFor(area: Area, homeHref: string | null, showAdminLink: boolean): NavItem[] {
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

/**
 * Instant feedback on a tap: while the next page is still being prepared, the link you pressed is already
 * highlighted (the page itself only changes when it arrives). Must sit inside the `Link`, which must be `relative`.
 */
function PendingHighlight({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 animate-in-soft bg-brand-soft/80", className)} />;
}

function Count({ n, label }: { n: number; label: string }) {
  // The wrapper stays mounted while the count is zero, so a count going from none to one pops like any other change.
  return (
    <ChangePulse value={n} className="ml-auto">
      {n > 0 ? (
        <span
          aria-label={label}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold leading-5 text-brand-foreground tabular-nums"
        >
          {n > 99 ? "99+" : n}
        </span>
      ) : null}
    </ChangePulse>
  );
}

function SidebarLink({ item, area }: { item: NavItem; area: Area }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const badges = useNavBadges();
  const active = isActive(pathname, item.href, area);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative isolate flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[color,background-color,transform] duration-150 before:absolute before:-inset-0.5 before:content-[''] active:scale-[0.98] motion-reduce:active:scale-100",
        active ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <PendingHighlight className="rounded-md" />
      <item.icon aria-hidden className="size-4" />
      {t(item.labelKey)}
      <Count n={badges?.[item.href] ?? 0} label={String(badges?.[item.href] ?? 0)} />
    </Link>
  );
}

/**
 * Desktop sidebar. A platform admin keeps their own company's menu and gets an expandable
 * "Administration" group under it (open while on an admin page), so the menu never swaps.
 */
export function SidebarNav(props: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const badges = useNavBadges();
  const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);
  const open = openChoice ?? onAdmin;

  const ownArea: Area | null = props.area !== "admin" ? props.area : props.homeHref ? (props.homeHref === "/buyer" ? "buyer" : "supplier") : null;
  const hasAdmin = props.area === "admin" || props.showAdminLink;

  // Admin without a company: just the admin items, flat.
  if (!ownArea) {
    return (
      <nav aria-label={t("menu")} className="flex flex-col gap-1">
        {NAV_ITEMS.admin.map((item) => (
          <SidebarLink key={item.href + item.labelKey} item={item} area="admin" />
        ))}
      </nav>
    );
  }

  const adminBadge = Object.entries(badges).reduce((sum, [href, n]) => (href.startsWith("/admin") ? sum + n : sum), 0);
  return (
    <nav aria-label={t("menu")} className="flex flex-col gap-1">
      {NAV_ITEMS[ownArea].map((item) => (
        <SidebarLink key={item.href + item.labelKey} item={item} area={ownArea} />
      ))}
      {hasAdmin ? (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="sidebar-admin-group"
            onClick={() => setOpenChoice(!open)}
            className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ShieldCheck aria-hidden className="size-4" />
            {t("admin")}
            {!open ? <Count n={adminBadge} label={String(adminBadge)} /> : null}
            <ChevronRight aria-hidden className={cn("ml-auto size-4 transition-transform", open && "rotate-90")} />
          </button>
          {open ? (
            <div id="sidebar-admin-group" className="ml-5 mt-1 flex flex-col gap-1 border-l border-border pl-2">
              {NAV_ITEMS.admin.map((item) => (
                <SidebarLink key={item.href + item.labelKey} item={item} area="admin" />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

/** A phone's bottom bar fits five slots. With more items, four show and the rest sit behind "More". */
const BOTTOM_SLOTS = 5;
/** Items whose label has a hyphenated variant under `nav.bar.*` (the longest words). */
const BAR_LABELS = ["suppliers", "products", "orders", "customers", "organizations", "requests", "overview"] as const;

export function BottomNav(props: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const badges = useNavBadges();
  const all = itemsFor(props.area, props.homeHref, props.showAdminLink).filter((item) => !item.inAccountMenuOnPhone);
  const overflow = all.length > BOTTOM_SLOTS;
  const primary = overflow ? all.slice(0, BOTTOM_SLOTS - 1) : all;
  const rest = overflow ? all.slice(BOTTOM_SLOTS - 1) : [];
  const restActive = rest.some((item) => isActive(pathname, item.href, props.area));
  const restBadge = rest.some((item) => (badges[item.href] ?? 0) > 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const slot = "flex min-h-[3.25rem] w-full min-w-0 flex-col items-center justify-center gap-1 px-0 text-center text-[0.6875rem] font-medium leading-tight";
  // Long words carry soft hyphens in `nav.bar.*`, so on a narrow phone they wrap at a syllable instead of being cut.
  // One pill slides under the active tab (a "More" that holds the active page counts as a tab). Every slot has the same width.
  const slots = primary.length + (overflow ? 1 : 0);
  const activeIndex = primary.findIndex((item) => isActive(pathname, item.href, props.area));
  const indicatorIndex = activeIndex >= 0 ? activeIndex : restActive || open ? primary.length : -1;
  // Tapping the tab you are already on goes back to the top of the page instead of reloading it.
  const toTop = (event: React.MouseEvent, href: string) => {
    if (pathname !== href) return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const barLabel = (key: NavItem["labelKey"]) => ((BAR_LABELS as readonly string[]).includes(key) ? t(`bar.${key as (typeof BAR_LABELS)[number]}`) : t(key));
  return (
    <>
      {open ? (
        <>
          <button type="button" aria-label={t("closeMore")} className="fixed inset-0 z-20 cursor-default md:hidden print:hidden" onClick={() => setOpen(false)} />
          <ul
            id="bottom-nav-more"
            className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 rounded-2xl border border-border bg-background p-2 shadow-lg md:hidden print:hidden"
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
                      "relative isolate flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium",
                      active ? "bg-brand-soft text-brand" : "text-foreground",
                    )}
                  >
                    <PendingHighlight className="rounded-md" />
                    <item.icon aria-hidden className="size-5" />
                    {t(item.labelKey)}
                    <Count n={badges[item.href] ?? 0} label={String(badges[item.href] ?? 0)} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <nav
        aria-label={t("menu")}
        className="[view-transition-name:app-bottom-nav] pointer-events-none fixed inset-x-0 bottom-0 z-30 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden print:hidden"
      >
        <ul className="pointer-events-auto relative mx-auto flex max-w-md rounded-2xl border border-border bg-background/85 p-0.5 shadow-lg backdrop-blur-md [transform:translateZ(0)]">
          <li
            aria-hidden
            data-bar-indicator
            className={cn(
              "pointer-events-none absolute inset-y-0.5 left-0.5 rounded-xl bg-brand-soft transition-[transform,opacity] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none",
              indicatorIndex < 0 && "opacity-0",
            )}
            style={{ width: `calc((100% - 0.25rem) / ${slots})`, transform: `translateX(${Math.max(indicatorIndex, 0) * 100}%)` }}
          />
          {primary.map((item) => {
            const active = isActive(pathname, item.href, props.area);
            const count = badges[item.href] ?? 0;
            return (
              <li key={item.href + item.labelKey} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    setOpen(false);
                    toTop(event, item.href);
                  }}
                  aria-label={count > 0 ? t("withCount", { label: t(item.labelKey), count }) : t(item.labelKey)}
                  className={cn(slot, "relative isolate transition-transform duration-150 before:absolute before:-inset-0.5 before:content-[''] active:scale-95 motion-reduce:active:scale-100", active ? "text-brand" : "text-muted-foreground")}
                >
                  <PendingHighlight />
                  <span className="relative">
                    <item.icon aria-hidden strokeWidth={active ? 2.4 : 2} className="size-5" />
                    <ChangePulse value={count} className="absolute -right-3 -top-1.5">
                      {count > 0 ? (
                        <span
                          aria-hidden
                          className="inline-flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.6875rem] font-semibold leading-4 text-brand-foreground tabular-nums"
                        >
                          {count > 99 ? "99+" : count}
                        </span>
                      ) : null}
                    </ChangePulse>
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
