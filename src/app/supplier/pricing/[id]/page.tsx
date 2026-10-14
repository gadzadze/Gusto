import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Pagination } from "@/components/app-shell/pagination";
import { PageHeader } from "@/components/app-shell/page-header";
import { BulkDiscount } from "@/components/pricing/bulk-discount";
import { OverrideEditor } from "@/components/pricing/override-editor";
import { PriceImport } from "@/components/pricing/price-import";
import { PriceListSettings } from "@/components/pricing/price-list-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import { requireSupplier } from "@/server/auth/guards";
import { getSupplierSettings } from "@/server/domain/catalog/supplier-settings";
import { NotFoundError } from "@/server/domain/errors";
import { customersOnPriceList, getPriceList, listPriceListProducts } from "@/server/domain/pricing/price-lists";

export default async function PriceListPage(props: PageProps<"/supplier/pricing/[id]">) {
  const t = await getTranslations("pricing");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/supplier/pricing">
          <ArrowLeft />
          {t("title")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <PriceList {...props} />
      </Suspense>
    </>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function PriceList({ params, searchParams }: PageProps<"/supplier/pricing/[id]">) {
  const ctx = await requireSupplier();
  const t = await getTranslations("pricing");
  const tc = await getTranslations("common");
  const tu = await getTranslations("units");
  const { id } = await params;
  const query = await searchParams;
  const q = one(query.q).slice(0, 100);
  const page = Number.parseInt(one(query.page), 10) || 1;

  const list = await getPriceList(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [products, settings, customerCount] = await Promise.all([
    listPriceListProducts(ctx, id, { q, page }),
    getSupplierSettings(ctx),
    customersOnPriceList(ctx, id),
  ]);
  const disabled = ctx.orgStatus === "suspended";

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader title={list.name} actions={list.isDefault ? <Badge tone="brand">{t("default")}</Badge> : null} />
        <p className="-mt-4 text-sm text-muted-foreground">{t("customers", { count: customerCount })}</p>
        <PriceListSettings
          priceListId={list.id}
          name={list.name}
          isDefault={list.isDefault}
          customerCount={customerCount}
          disabled={disabled}
        />
      </div>

      <section className="space-y-3">
        <form method="get" className="flex max-w-xl gap-2">
          <label className="sr-only" htmlFor="q">{tc("search")}</label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder={tc("searchPlaceholder")} />
          <Button type="submit" variant="outline">
            <Search />
            {tc("apply")}
          </Button>
        </form>
        {products.items.length === 0 ? (
          <EmptyState icon={Search} title={q ? tc("search") : t("detail.noProducts")} />
        ) : (
          <>
            <OverrideEditor
              key={`${q}-${products.page}`}
              priceListId={list.id}
              disabled={disabled}
              rows={products.items.map((p) => ({
                productId: p.productId,
                name: p.name,
                sku: p.sku,
                unitLabel: tu(p.unit as "kg"),
                isActive: p.isActive,
                basePriceLabel: formatMoney(p.basePriceMinor, settings.currency),
                overrideMinor: p.overrideMinor,
              }))}
            />
            <Pagination basePath={`/supplier/pricing/${list.id}`} params={{ q }} page={products.page} pageCount={products.pageCount} />
          </>
        )}
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="font-semibold">{t("detail.bulkTitle")}</h2>
        <BulkDiscount priceListId={list.id} disabled={disabled} />
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="font-semibold">{t("detail.importTitle")}</h2>
        <PriceImport priceListId={list.id} disabled={disabled} />
      </section>
    </div>
  );
}
