import { ChevronRight, PackageSearch } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProductCard } from "@/components/buyer/product-card";
import { toProductViews } from "@/components/buyer/product-view";
import { BuyerSearchForm } from "@/components/buyer/search-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";
import { searchConnectedCatalogs } from "@/server/domain/buyer/catalog";

export default async function BuyerSearchPage({ searchParams }: PageProps<"/buyer/search">) {
  const t = await getTranslations("buyer");
  return (
    <>
      <PageHeader title={t("searchTitle")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/buyer/search">, "searchParams">) {
  const ctx = await requireBuyer();
  const t = await getTranslations("buyer");
  const { q: raw } = await searchParams;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  const groups = await Promise.all(
    (q ? await searchConnectedCatalogs(ctx, q) : []).map(async (g) => ({ ...g, views: await toProductViews(g.items, g.supplier) })),
  );

  return (
    <div className="space-y-6">
      <BuyerSearchForm defaultValue={q} />
      {!q ? (
        <p className="text-sm text-muted-foreground">{t("searchHint")}</p>
      ) : groups.length === 0 ? (
        <EmptyState icon={PackageSearch} title={t("searchEmpty")} body={t("searchHint")} />
      ) : (
        groups.map((group) => (
          <section key={group.supplier.id} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{group.supplier.name}</h2>
              {group.totalMatches > group.items.length ? (
                <Link
                  href={`/buyer/suppliers/${group.supplier.id}?q=${encodeURIComponent(q)}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                >
                  {t("showMore", { count: group.totalMatches })}
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.views.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
