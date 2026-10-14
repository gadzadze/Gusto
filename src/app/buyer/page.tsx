import { Store } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";

export default async function BuyerDashboardPage() {
  const t = await getTranslations("buyer");
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
  await requireBuyer();
  const t = await getTranslations("buyer");
  return <EmptyState icon={Store} title={t("emptyTitle")} body={t("emptyBody")} />;
}
