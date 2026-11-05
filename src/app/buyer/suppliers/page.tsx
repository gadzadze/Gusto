import { Plus, Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { SupplierCard } from "@/components/buyer/supplier-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";
import { listConnectedSuppliers } from "@/server/domain/buyer/catalog";

export default async function BuyerSuppliersPage() {
  const t = await getTranslations("buyer");
  return (
    <>
      <PageHeader
        title={t("suppliersTitle")}
        actions={
          <Button asChild variant="outline">
            <Link href="/buyer/suppliers/invite">
              <Plus />
              {t("inviteSupplier")}
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <Suppliers />
      </Suspense>
    </>
  );
}

async function Suppliers() {
  const ctx = await requireBuyer();
  const t = await getTranslations("buyer");
  const suppliers = await listConnectedSuppliers(ctx);
  if (suppliers.length === 0) return <EmptyState icon={Store} title={t("emptyTitle")} body={t("emptyBody")} />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {suppliers.map((s) => (
        <SupplierCard key={s.id} supplier={s} />
      ))}
    </div>
  );
}
