import { LogOut } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type * as React from "react";
import { LocaleSwitch } from "@/components/locale-switch";
import { NotificationBellFallback } from "@/components/notifications/notification-bell";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Area } from "./nav";
import { SideSwitch, type Side } from "./side-switch";
import { PushNavigation } from "@/components/push/push-navigation";
import { AccountMenu } from "./account-menu";
import { CommandPalette, PaletteTrigger } from "./command-palette";
import { NavBadgesProvider } from "./nav-badges";
import { BottomNav, SidebarNav } from "./nav-links";

export type ShellProps = {
  area: Area;
  /** Org name, or null in the admin area for a user without an org. */
  title: string | null;
  email: string | null;
  /** The user's own org dashboard (shown as a link from the admin area). */
  homeHref: string | null;
  showAdminLink: boolean;
  /** Notification bell (buyer and supplier areas); rendered in Suspense by the shell. */
  bell?: React.ReactNode;
  /** The person's own organizations, when there is more than one (buyer and supplier side). */
  sides?: Side[];
  /** The side this person could still add (an "also sell / also buy" link), or null. */
  addSide?: "buyer" | "supplier" | null;
  /** Offer "add another company" of this kind (a further brand of the same group). */
  addCompany?: "buyer" | "supplier" | null;
  /** Counts shown next to nav items, keyed by href. */
  navBadges?: Record<string, number>;
  children: React.ReactNode;
};

export async function AppShell({ area, title, email, homeHref, showAdminLink, bell, sides, addSide, addCompany, navBadges, children }: ShellProps) {
  const t = await getTranslations();
  const roleLabel = t(`roles.${area}`);
  const navProps = { area, homeHref, showAdminLink, badges: navBadges };

  return (
    <NavBadgesProvider initial={navBadges} pollPending={area === "supplier"}>
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr] print:block">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground print:hidden"
      >
        {t("nav.skipToContent")}
      </a>
      <aside className="hidden border-r border-border bg-surface-2 md:sticky md:top-0 md:flex md:h-dvh md:flex-col print:!hidden">
        <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-5">
          <Logo />
          {bell ? <Suspense fallback={<NotificationBellFallback />}>{bell}</Suspense> : null}
        </div>
        <div className="px-5 pb-5">
          {title ? <p className="truncate text-sm font-medium" title={title}>{title}</p> : null}
          {sides && sides.length > 1 ? (
            <div className="mt-2">
              <SideSwitch sides={sides} />
            </div>
          ) : (
            <Badge tone="brand" className="mt-1.5">{roleLabel}</Badge>
          )}
        </div>
        <div className="px-3 pb-3">
          <PaletteTrigger />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <SidebarNav {...navProps} />
        </div>
        <div className="border-t border-border p-3">
          {email ? <p className="truncate px-3 pb-1 text-xs text-muted-foreground" title={email}>{email}</p> : null}
          <Link href="/account/password" className="block px-3 pb-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
            {t("nav.changePassword")}
          </Link>
          {area !== "admin" ? (
            <Link href={`/${area}/team`} className="block px-3 pb-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
              {t("nav.team")}
            </Link>
          ) : null}
          {addCompany ? (
            <Link href={`/account/add-side?another=${addCompany}`} className="block px-3 pb-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
              {t(`nav.addCompany.${addCompany}`)}
            </Link>
          ) : null}
          {addSide ? (
            <Link href="/account/add-side" className="block px-3 pb-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
              {t(`nav.addSide.${addSide}`)}
            </Link>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
            <LocaleSwitch />
            <ThemeToggle />
          </div>
          <SignOutButton label={t("nav.signOut")} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden print:hidden">
          <div className="flex min-w-0 items-center">
            <span className="truncate text-base font-semibold">{title ?? roleLabel}</span>
          </div>
          <div className="flex items-center">
            {area !== "buyer" ? <PaletteTrigger compact /> : null}
            {bell ? <Suspense fallback={<NotificationBellFallback />}>{bell}</Suspense> : null}
            <ThemeToggle compact />
            <AccountMenu area={area} email={email} showAdminLink={showAdminLink} />
          </div>
        </header>
        {sides && sides.length > 1 ? (
          // Both sides: a full-width two-part switch under the header, easy to hit with a thumb.
          <div className="border-b border-border bg-surface-2 px-4 py-2 md:hidden print:hidden">
            <SideSwitch sides={sides} compact />
          </div>
        ) : null}
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 outline-none px-4 pb-24 pt-6 sm:px-6 md:pb-10 md:pt-8 print:p-0">
          {children}
        </main>
      </div>

      <BottomNav {...navProps} />
      <PushNavigation />
      <CommandPalette area={area} homeHref={homeHref} showAdminLink={showAdminLink} entitySearch={area !== "admin"} />
    </div>
    </NavBadgesProvider>
  );
}

function SignOutButton({ label }: { label: string }) {
  return (
    <form action="/auth/sign-out" method="post">
      <Button type="submit" variant="ghost" className="w-full justify-start text-muted-foreground">
        <LogOut />
        {label}
      </Button>
    </form>
  );
}

export function AppShellSkeleton() {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-border bg-surface-2 p-5 md:block">
        <Logo />
        <Skeleton className="mt-6 h-4 w-32" />
        <Skeleton className="mt-6 h-9 w-full" />
      </aside>
      <div className="px-4 pt-6 sm:px-6 md:pt-8">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-6 h-40 w-full max-w-5xl" />
      </div>
    </div>
  );
}
