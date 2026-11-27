import { Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app-shell/app-shell";
import { listConnectedSuppliers } from "@/server/domain/buyer/catalog";
import { voiceOrderEnabled } from "@/server/voice/config";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getAccessState, requireBuyer } from "@/server/auth/guards";
import { listCarts } from "@/server/domain/orders/cart";

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
  const [state, carts] = await Promise.all([getAccessState(), listCarts(ctx)]);
  // The assistant (dock and panel) is only offered to an approved buyer with something to order, and only while voice ordering is on.
  const voiceSuppliers =
    voiceOrderEnabled() && ctx.orgStatus === "active" ? (await listConnectedSuppliers(ctx)).filter((s) => s.productCount > 0).map((s) => ({ name: s.name, count: s.productCount })) : [];
  const memberships = state.signedIn ? state.memberships : [];
  const sides = memberships.map((m) => ({ orgId: m.orgId, type: m.orgType, name: m.orgName, current: m.orgId === ctx.orgId }));
  const missing = memberships.length === 1 ? (memberships[0].orgType === "buyer" ? "supplier" : "buyer") : null;
  return (
    <AppShell
      area="buyer"
      title={ctx.orgName}
      email={ctx.email}
      homeHref="/buyer"
      showAdminLink={ctx.isPlatformAdmin}
      navBadges={{ "/buyer/cart": carts.reduce((sum, c) => sum + c.itemCount, 0) }}
      sides={sides}
      addSide={missing}
      addCompany={ctx.orgStatus === "active" ? "buyer" : null}
      assistant={voiceSuppliers.length > 0 ? { role: "buyer", suppliers: voiceSuppliers } : undefined}
      bell={<NotificationBell userId={ctx.userId} area="buyer" />}
    >
      {children}
    </AppShell>
  );
}
