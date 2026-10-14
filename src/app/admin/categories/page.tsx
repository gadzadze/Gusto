import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/auth/guards";
import { listAllCategories } from "@/server/domain/catalog/categories";
import { CategoryManager } from "./category-manager";

export default async function AdminCategoriesPage() {
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={t("categoriesTitle")} />
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-3xl" />}>
        <Categories />
      </Suspense>
    </>
  );
}

async function Categories() {
  const ctx = await requireAdmin();
  const categories = await listAllCategories(ctx);
  return (
    <CategoryManager
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        isArchived: c.isArchived,
        productCount: c.productCount,
      }))}
    />
  );
}
