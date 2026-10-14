import { Clock, Inbox, PauseCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";

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
      <EmptyState icon={Inbox} title={t("emptyTitle")} body={t("emptyBody")} />
    </div>
  );
}
