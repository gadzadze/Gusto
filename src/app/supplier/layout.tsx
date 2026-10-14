import { Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app-shell/app-shell";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { requireSupplier } from "@/server/auth/guards";

// The guard here picks the shell; it does not protect child pages on its own.
// Every page and action under /supplier calls requireSupplier() itself.
export default function SupplierLayout({ children }: LayoutProps<"/supplier">) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <SupplierShell>{children}</SupplierShell>
    </Suspense>
  );
}

async function SupplierShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireSupplier();
  return (
    <AppShell
      area="supplier"
      title={ctx.orgName}
      email={ctx.email}
      homeHref="/supplier"
      showAdminLink={ctx.isPlatformAdmin}
      bell={<NotificationBell userId={ctx.userId} area="supplier" />}
    >
      {children}
    </AppShell>
  );
}
