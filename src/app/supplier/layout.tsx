import { Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app-shell/app-shell";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getAccessState, requireSupplier } from "@/server/auth/guards";

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
  const state = await getAccessState();
  const memberships = state.signedIn ? state.memberships : [];
  const sides = memberships.map((m) => ({ orgId: m.orgId, type: m.orgType, current: m.orgId === ctx.orgId }));
  const missing = memberships.length === 1 ? (memberships[0].orgType === "buyer" ? "supplier" : "buyer") : null;
  return (
    <AppShell
      area="supplier"
      title={ctx.orgName}
      email={ctx.email}
      homeHref="/supplier"
      showAdminLink={ctx.isPlatformAdmin}
      sides={sides}
      addSide={missing}
      bell={<NotificationBell userId={ctx.userId} area="supplier" />}
    >
      {children}
    </AppShell>
  );
}
