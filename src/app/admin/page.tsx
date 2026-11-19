import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DashboardSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/app-shell/page-header";
import { AdminOverview } from "@/components/dashboard/admin-overview";
import { requireAdmin } from "@/server/auth/guards";
import { countPendingOrganizations } from "@/server/domain/admin/organizations";
import { countSupplierRequests } from "@/server/domain/admin/supplier-requests";
import { countSuppliersByStatus } from "@/server/domain/admin/suppliers";
import { getPilotMetrics } from "@/server/domain/metrics/pilot";
import { checkHealth } from "@/server/health";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={t("overviewTitle")} />
      <Suspense fallback={<DashboardSkeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  const ctx = await requireAdmin();
  const [suppliers, pendingBuyers, requests, pilot, health] = await Promise.all([
    countSuppliersByStatus(ctx),
    countPendingOrganizations(ctx, "buyer"),
    countSupplierRequests(ctx),
    getPilotMetrics(ctx),
    checkHealth(),
  ]);
  return <AdminOverview suppliers={suppliers} pendingBuyers={pendingBuyers} newRequests={requests.new} pilot={pilot} health={health} />;
}
