import { Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app-shell/app-shell";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getAccessState, requireSupplier } from "@/server/auth/guards";
import { getPendingPulse } from "@/server/domain/orders/today";

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
  const [state, pulse] = await Promise.all([getAccessState(), getPendingPulse(ctx)]);
  const memberships = state.signedIn ? state.memberships : [];
  const sides = memberships.map((m) => ({ orgId: m.orgId, type: m.orgType, name: m.orgName, current: m.orgId === ctx.orgId }));
  const missing = memberships.length === 1 ? (memberships[0].orgType === "buyer" ? "supplier" : "buyer") : null;
  return (
    <AppShell
      area="supplier"
      title={ctx.orgName}
      email={ctx.email}
      homeHref="/supplier"
      showAdminLink={ctx.isPlatformAdmin}
      navBadges={{ "/supplier/orders": pulse.pending }}
      sides={sides}
      addSide={missing}
      addCompany={ctx.orgStatus === "active" ? "supplier" : null}
      bell={<NotificationBell userId={ctx.userId} area="supplier" />}
    >
      {children}
    </AppShell>
  );
}
