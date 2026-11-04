import { ImageDown } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PhotoSuggestions } from "@/components/catalog/photo-suggestions";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";
import { listProductsNeedingPhotos } from "@/server/domain/catalog/photo-fetch";

export default async function PhotoReviewPage() {
  const t = await getTranslations("photoSuggest");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  const ctx = await requireSupplier();
  const t = await getTranslations("photoSuggest");
  const items = await listProductsNeedingPhotos(ctx);
  if (items.length === 0) return <EmptyState icon={ImageDown} title={t("emptyTitle")} body={t("emptyBody")} />;
  return (
    <div className="max-w-4xl space-y-5">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <PhotoSuggestions products={items} disabled={ctx.orgStatus === "suspended"} />
    </div>
  );
}
