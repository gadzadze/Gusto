import { Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app-shell/app-shell";
import { homePathFor } from "@/server/auth/access";
import { getAccessState, requireAdmin } from "@/server/auth/guards";
import { countPendingOrganizations } from "@/server/domain/admin/organizations";
import { countSupplierRequests } from "@/server/domain/admin/supplier-requests";
import { countSuppliersByStatus } from "@/server/domain/admin/suppliers";

// The guard here picks the shell; it does not protect child pages on its own.
// Every page and action under /admin calls requireAdmin() itself.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdmin();
  const state = await getAccessState();
  // Suppliers waiting for approval: shown next to "Suppliers" so it can't be missed.
  const pending = (await countSuppliersByStatus(ctx)).pending_review;
  const pendingBuyers = await countPendingOrganizations(ctx, "buyer");
  const requests = await countSupplierRequests(ctx);
  const membership = state.signedIn ? state.membership : null;
  return (
    <AppShell
      area="admin"
      title={membership?.orgName ?? null}
      email={ctx.email}
      homeHref={membership ? homePathFor(state) : null}
      showAdminLink={false}
      navBadges={{ "/admin/suppliers": pending, "/admin/organizations": pendingBuyers, "/admin/requests": requests.new }}
    >
      {children}
    </AppShell>
  );
}
