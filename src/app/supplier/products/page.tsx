import { FileUp, PackageSearch, Plus, Search } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Pagination } from "@/components/app-shell/pagination";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProductImage } from "@/components/catalog/product-image";
import { ProductStatusBadge } from "@/components/catalog/product-status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { requireSupplier } from "@/server/auth/guards";
import { listActiveCategories } from "@/server/domain/catalog/categories";
import { isUuid, listSupplierProducts } from "@/server/domain/catalog/products";
import { getSupplierSettings } from "@/server/domain/catalog/supplier-settings";

export default async function ProductsPage({ searchParams }: PageProps<"/supplier/products">) {
  const t = await getTranslations("products");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ProductList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function ProductList({ searchParams }: Pick<PageProps<"/supplier/products">, "searchParams">) {
  const ctx = await requireSupplier();
  const t = await getTranslations("products");
  const tc = await getTranslations("common");
  const tu = await getTranslations("units");

  const params = await searchParams;
  const q = one(params.q).slice(0, 100);
  const categoryId = isUuid(one(params.category)) ? one(params.category) : "";
  const statusParam = one(params.status);
  const status = statusParam === "active" || statusParam === "inactive" ? statusParam : "all";
  const page = Number.parseInt(one(params.page), 10) || 1;

  const [list, categories, settings] = await Promise.all([
    listSupplierProducts(ctx, { q, categoryId: categoryId || undefined, status, page }),
    listActiveCategories(),
    getSupplierSettings(ctx),
  ]);
  const readOnly = ctx.orgStatus === "suspended";
  const filtered = Boolean(q || categoryId || status !== "all");

  return (
    <div className="space-y-5">
      {readOnly ? <Notice icon={PackageSearch} title={t("suspendedReadOnly")} /> : null}

      <form method="get" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_12rem_auto]">
        <label className="sr-only" htmlFor="q">{tc("search")}</label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder={tc("searchPlaceholder")} className="sm:col-span-2 lg:col-span-1" />
        <label className="sr-only" htmlFor="category">{t("filters.category")}</label>
        <Select id="category" name="category" defaultValue={categoryId}>
          <option value="">{t("filters.category")}: {tc("all")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="status">{t("filters.status")}</label>
        <Select id="status" name="status" defaultValue={status}>
          <option value="all">{t("filters.status")}: {tc("all")}</option>
          <option value="active">{t("filters.active")}</option>
          <option value="inactive">{t("filters.inactive")}</option>
        </Select>
        <Button type="submit" variant="outline" className="sm:col-span-2 lg:col-span-1">
          <Search />
          {tc("apply")}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{tc("total", { count: list.total })}</p>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/supplier/products/import">
                <FileUp />
                {t("import")}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/supplier/products/new">
                <Plus />
                {t("new")}
              </Link>
            </Button>
          </div>
        )}
      </div>

      {list.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={PackageSearch} title={t("noResultsTitle")} body={t("noResultsBody")} />
        ) : (
          <EmptyState icon={PackageSearch} title={t("emptyTitle")} body={t("emptyBody")} />
        )
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>{t("columns.product")}</TH>
                  <TH>{t("columns.category")}</TH>
                  <TH className="text-right">{t("columns.price")}</TH>
                  <TH>{t("columns.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {list.items.map((p) => (
                  <TR key={p.id} className="hover:bg-muted/50">
                    <TD>
                      <Link href={`/supplier/products/${p.id}`} className="flex items-center gap-3 font-medium hover:underline">
                        <ProductImage path={p.imagePath} alt="" size={40} />
                        <span className="min-w-0">
                          <span className="block truncate">{p.name}</span>
                          <span className="block text-xs font-normal text-muted-foreground">
                            {[p.sku, p.brand, p.packDescription].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-muted-foreground">{p.categoryName}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      {formatMoney(p.basePriceMinor, settings.currency)}{" "}
                      <span className="text-muted-foreground">{t("perUnit", { unit: tu(p.unit) })}</span>
                    </TD>
                    <TD><ProductStatusBadge isActive={p.isActive} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {/* Mobile list */}
          <ul className="divide-y divide-border rounded-xl border border-border md:hidden">
            {list.items.map((p) => (
              <li key={p.id}>
                <Link href={`/supplier/products/${p.id}`} className="flex items-center gap-3 p-3">
                  <ProductImage path={p.imagePath} alt="" size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-sm tabular-nums text-muted-foreground">
                      {formatMoney(p.basePriceMinor, settings.currency)} {t("perUnit", { unit: tu(p.unit) })}
                    </span>
                  </span>
                  <ProductStatusBadge isActive={p.isActive} />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            basePath="/supplier/products"
            params={{ q, category: categoryId, status: status === "all" ? undefined : status }}
            page={list.page}
            pageCount={list.pageCount}
          />
        </>
      )}
    </div>
  );
}
