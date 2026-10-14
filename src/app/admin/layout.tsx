import { Suspense } from "react";
import { AppShell, AppShellSkeleton } from "@/components/app-shell/app-shell";
import { homePathFor } from "@/server/auth/access";
import { getAccessState, requireAdmin } from "@/server/auth/guards";

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
  const membership = state.signedIn ? state.membership : null;
  return (
    <AppShell
      area="admin"
      title={membership?.orgName ?? null}
      email={ctx.email}
      homeHref={membership ? homePathFor(state) : null}
      showAdminLink={false}
    >
      {children}
    </AppShell>
  );
}
