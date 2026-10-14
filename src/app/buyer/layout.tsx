import { Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app-shell/app-shell";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { requireBuyer } from "@/server/auth/guards";

// The guard here picks the shell; it does not protect child pages on its own.
// Every page and action under /buyer calls requireBuyer() itself.
export default function BuyerLayout({ children }: LayoutProps<"/buyer">) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <BuyerShell>{children}</BuyerShell>
    </Suspense>
  );
}

async function BuyerShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireBuyer();
  return (
    <AppShell
      area="buyer"
      title={ctx.orgName}
      email={ctx.email}
      homeHref="/buyer"
      showAdminLink={ctx.isPlatformAdmin}
      bell={<NotificationBell userId={ctx.userId} area="buyer" />}
    >
      {children}
    </AppShell>
  );
}
