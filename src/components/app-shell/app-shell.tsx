import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type * as React from "react";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Area } from "./nav";
import { BottomNav, SidebarNav } from "./nav-links";

export type ShellProps = {
  area: Area;
  /** Org name, or null in the admin area for a user without an org. */
  title: string | null;
  email: string | null;
  /** The user's own org dashboard (shown as a link from the admin area). */
  homeHref: string | null;
  showAdminLink: boolean;
  children: React.ReactNode;
};

export async function AppShell({ area, title, email, homeHref, showAdminLink, children }: ShellProps) {
  const t = await getTranslations();
  const roleLabel = t(`roles.${area}`);
  const navProps = { area, homeHref, showAdminLink };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr] print:block">
      <aside className="hidden border-r border-border bg-surface-2 md:flex md:min-h-dvh md:flex-col print:!hidden">
        <div className="px-5 pb-4 pt-5">
          <Logo />
        </div>
        <div className="px-5 pb-5">
          {title ? <p className="truncate text-sm font-medium" title={title}>{title}</p> : null}
          <Badge tone="brand" className="mt-1.5">{roleLabel}</Badge>
        </div>
        <div className="flex-1 px-3">
          <SidebarNav {...navProps} />
        </div>
        <div className="border-t border-border p-3">
          {email ? <p className="truncate px-3 pb-2 text-xs text-muted-foreground" title={email}>{email}</p> : null}
          <SignOutButton label={t("nav.signOut")} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:hidden print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="text-base" />
            {title ? <span className="truncate text-sm text-muted-foreground">{title}</span> : null}
          </div>
          <SignOutButton label={t("nav.signOut")} compact />
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 sm:px-6 md:pb-10 md:pt-8 print:p-0">
          {children}
        </main>
      </div>

      <BottomNav {...navProps} />
    </div>
  );
}

function SignOutButton({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <form action="/auth/sign-out" method="post">
      {compact ? (
        <Button type="submit" variant="ghost" size="icon" aria-label={label} title={label}>
          <LogOut />
        </Button>
      ) : (
        <Button type="submit" variant="ghost" className="w-full justify-start text-muted-foreground">
          <LogOut />
          {label}
        </Button>
      )}
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
