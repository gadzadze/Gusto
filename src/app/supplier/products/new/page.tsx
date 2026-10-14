import { Tags } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProductForm } from "@/components/catalog/product-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { NEW_PRODUCT_DEFAULTS } from "@/lib/validation/product";
import { requireSupplier } from "@/server/auth/guards";
import { listActiveCategories } from "@/server/domain/catalog/categories";
import { getSupplierSettings } from "@/server/domain/catalog/supplier-settings";

export default async function NewProductPage() {
  const t = await getTranslations("products.form");
  return (
    <>
      <PageHeader title={t("newTitle")} />
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-3xl" />}>
        <NewProduct />
      </Suspense>
    </>
  );
}

async function NewProduct() {
  const ctx = await requireSupplier();
  if (ctx.orgStatus === "suspended") notFound();
  const t = await getTranslations("supplier");
  const [categories, settings] = await Promise.all([listActiveCategories(), getSupplierSettings(ctx)]);
  if (categories.length === 0) {
    return <EmptyState icon={Tags} title={t("noCategoriesTitle")} body={t("noCategoriesBody")} />;
  }
  return (
    <div className="max-w-3xl">
      <ProductForm
        mode="create"
        defaultValues={NEW_PRODUCT_DEFAULTS}
        categories={categories}
        pricesIncludeVat={settings.pricesIncludeVat}
      />
    </div>
  );
}
