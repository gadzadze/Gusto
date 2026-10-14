import { ArrowLeft, Tags } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";
import { listActiveCategories } from "@/server/domain/catalog/categories";
import { getSavedImportMapping } from "@/server/domain/catalog/import";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  const t = await getTranslations();
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/supplier/products">
          <ArrowLeft />
          {t("products.title")}
        </Link>
      </Button>
      <PageHeader title={t("import.title")} />
      <Suspense fallback={<Skeleton className="h-48 w-full max-w-4xl" />}>
        <Import />
      </Suspense>
    </>
  );
}

async function Import() {
  const ctx = await requireSupplier();
  if (ctx.orgStatus === "suspended") notFound();
  const t = await getTranslations("supplier");
  const [categories, savedMapping] = await Promise.all([listActiveCategories(), getSavedImportMapping(ctx)]);
  if (categories.length === 0) {
    return <EmptyState icon={Tags} title={t("noCategoriesTitle")} body={t("noCategoriesBody")} />;
  }
  return <ImportWizard savedMapping={savedMapping} />;
}
