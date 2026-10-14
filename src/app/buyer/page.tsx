import { Store } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { BuyerSearchForm } from "@/components/buyer/search-form";
import { SupplierCard } from "@/components/buyer/supplier-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";
import { listConnectedSuppliers } from "@/server/domain/buyer/catalog";

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
  const ctx = await requireBuyer();
  const t = await getTranslations("buyer");
  const suppliers = await listConnectedSuppliers(ctx);
  if (suppliers.length === 0) {
    return <EmptyState icon={Store} title={t("emptyTitle")} body={t("emptyBody")} />;
  }
  return (
    <div className="space-y-6">
      <BuyerSearchForm />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("suppliersTitle")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {suppliers.map((s) => (
            <SupplierCard key={s.id} supplier={s} />
          ))}
        </div>
      </section>
    </div>
  );
}
