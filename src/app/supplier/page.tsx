import { Clock, Inbox, PauseCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";
import { countSupplierOrders } from "@/server/domain/orders/queries";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function SupplierDashboardPage() {
  const t = await getTranslations("supplier");
  return (
    <>
      <PageHeader title={t("dashboardTitle")} />
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  const ctx = await requireSupplier();
  const t = await getTranslations("supplier");
  const counts = await countSupplierOrders(ctx);
  const total = counts.new + counts.confirmed + counts.done;
  return (
    <div className="space-y-6">
      {ctx.orgStatus === "pending_review" ? (
        <Notice icon={Clock} tone="amber" title={t("pendingTitle")}>
          {t("pendingBody")}
        </Notice>
      ) : null}
      {ctx.orgStatus === "suspended" ? (
        <Notice icon={PauseCircle} title={t("suspendedTitle")}>
          {t("suspendedBody")}
        </Notice>
      ) : null}
      {total === 0 ? (
        <EmptyState icon={Inbox} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-5">
          <p className="text-lg font-semibold">{t("newOrders", { count: counts.new })}</p>
          <Button asChild>
            <Link href="/supplier/orders">{t("openOrders")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
