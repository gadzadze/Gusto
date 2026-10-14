import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/auth/guards";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={t("overviewTitle")} />
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <Overview />
      </Suspense>
    </>
  );
}

async function Overview() {
  await requireAdmin();
  const t = await getTranslations("admin");
  return <EmptyState icon={ShieldCheck} title={t("emptyTitle")} body={t("emptyBody")} />;
}
