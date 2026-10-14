import { ArrowLeft, PackageSearch, Phone, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Pagination } from "@/components/app-shell/pagination";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProductCard } from "@/components/buyer/product-card";
import { toProductViews } from "@/components/buyer/product-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { requireBuyer } from "@/server/auth/guards";
import { getConnectedSupplier, listBuyerCatalog } from "@/server/domain/buyer/catalog";
import { NotFoundError } from "@/server/domain/errors";

export default async function SupplierCatalogPage(props: PageProps<"/buyer/suppliers/[id]">) {
  const t = await getTranslations("buyer");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/buyer/suppliers">
          <ArrowLeft />
          {t("suppliersTitle")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Catalog {...props} />
      </Suspense>
    </>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function Catalog({ params, searchParams }: PageProps<"/buyer/suppliers/[id]">) {
  const ctx = await requireBuyer();
  const t = await getTranslations("buyer");
  const tc = await getTranslations("common");
  const { id } = await params;
  const query = await searchParams;
  const q = one(query.q).slice(0, 100);
  const categoryId = one(query.category);
  const page = Number.parseInt(one(query.page), 10) || 1;

  const notFoundOn404 = (error: unknown): never => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  };
  const supplier = await getConnectedSupplier(ctx, id).catch(notFoundOn404);
  const catalog = await listBuyerCatalog(ctx, id, { q, categoryId, page }).catch(notFoundOn404);
  const views = await toProductViews(catalog.items, supplier);

  const filterHref = (category: string) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (category) search.set("category", category);
    const qs = search.toString();
    return `/buyer/suppliers/${id}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <PageHeader title={supplier.name} />
        <div className="-mt-3 space-y-1 text-sm text-muted-foreground">
          <p>
            {supplier.minOrderMinor > 0
              ? t("minOrder", { amount: formatMoney(supplier.minOrderMinor, supplier.currency) })
              : t("noMinOrder")}
            {" · "}
            {supplier.pricesIncludeVat ? t("vatIncluded") : t("vatExcluded")}
          </p>
          {supplier.deliveryArea ? <p>{t("deliveryArea", { area: supplier.deliveryArea })}</p> : null}
          {supplier.orderCutoffNote ? <p>{t("cutoff", { note: supplier.orderCutoffNote })}</p> : null}
          <p className="flex items-center gap-1.5">
            <Phone aria-hidden className="size-3.5" />
            <a href={`tel:${supplier.phone}`} className="tabular-nums hover:underline">{formatPhone(supplier.phone)}</a>
          </p>
        </div>
        {supplier.deliveryTerms ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">{t("deliveryTerms")}</summary>
            <p className="mt-2 whitespace-pre-line text-muted-foreground">{supplier.deliveryTerms}</p>
          </details>
        ) : null}
      </div>

      <form method="get" className="flex max-w-xl gap-2">
        {categoryId ? <input type="hidden" name="category" value={categoryId} /> : null}
        <label htmlFor="q" className="sr-only">{tc("search")}</label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder={tc("searchPlaceholder")} />
        <Button type="submit" variant="outline" aria-label={tc("search")}>
          <Search />
        </Button>
      </form>

      {catalog.categories.length > 1 ? (
        <nav aria-label={t("allCategories")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {[{ id: "", name: t("allCategories") }, ...catalog.categories].map((c) => {
            const active = (categoryId || "") === c.id;
            return (
              <Link
                key={c.id || "all"}
                href={filterHref(c.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-sm",
                  active ? "border-brand bg-brand-soft text-brand" : "border-border hover:bg-muted",
                )}
              >
                {c.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {catalog.items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={q || categoryId ? t("searchEmpty") : t("catalogEmpty")}
          body={q ? t("searchHint") : undefined}
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {views.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <Pagination
            basePath={`/buyer/suppliers/${id}`}
            params={{ q, category: categoryId }}
            page={catalog.page}
            pageCount={catalog.pageCount}
          />
        </>
      )}
    </div>
  );
}
