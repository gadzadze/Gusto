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
import { toProductViews } from "@/components/buyer/product-view";
import { ProductCard } from "@/components/buyer/product-card";
import { listTopOrderedProducts } from "@/server/domain/buyer/catalog";
import { listBuyerOrders, listOpenBuyerOrders } from "@/server/domain/orders/queries";
import { ReorderButton } from "@/components/orders/order-buttons";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { formatMoney } from "@/lib/money";
import Link from "next/link";

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
  const [suppliers, recent, open, top] = await Promise.all([
    listConnectedSuppliers(ctx),
    listBuyerOrders(ctx, 1, 5),
    listOpenBuyerOrders(ctx),
    listTopOrderedProducts(ctx, 10),
  ]);
  const to = await getTranslations("orders");
  const td = await getTranslations("buyer.dashboard");
  const topViews = await Promise.all(
    top.map(async (entry) => {
      const [view] = await toProductViews([entry.product], entry.supplier, new Map([[entry.product.id, entry.cartQtyMilli]]));
      return { view, entry };
    }),
  );
  if (suppliers.length === 0 && recent.items.length === 0) {
    return <EmptyState icon={Store} title={t("emptyTitle")} body={t("emptyBody")} />;
  }
  return (
    <div className="space-y-6">
      <BuyerSearchForm />
      <section className="space-y-3" aria-labelledby="open-orders">
        <h2 id="open-orders" className="text-sm font-semibold text-muted-foreground">{td("open")}</h2>
        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">{td("openEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {open.map((o) => (
              <li key={o.id}>
                <Link href={`/buyer/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium tabular-nums">{to("number", { number: o.number })}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {o.supplierName} · {formatMoney(o.totalMinor, o.currency)}
                    </span>
                  </span>
                  <OrderStatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {recent.items.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{to("recent")}</h2>
            <Link href="/buyer/orders" className="text-sm font-medium text-brand hover:underline">{to("viewAll")}</Link>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {recent.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/buyer/orders/${o.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="font-medium tabular-nums">{to("number", { number: o.number })}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {o.supplierName} · {formatMoney(o.totalMinor, o.currency)}
                  </span>
                </Link>
                <OrderStatusBadge status={o.status} />
                <ReorderButton orderId={o.id} size="sm" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {topViews.length > 0 ? (
        <section className="space-y-3" aria-labelledby="top-products">
          <div>
            <h2 id="top-products" className="text-sm font-semibold text-muted-foreground">{td("topTitle")}</h2>
            <p className="text-xs text-muted-foreground">{td("topHint")}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {topViews.map(({ view, entry }) => (
              <div key={view.id} className="space-y-1">
                <ProductCard product={view} />
                <p className="px-1 text-xs text-muted-foreground">
                  {td("from", { supplier: entry.supplier.name })} · {td("orderedTimes", { count: entry.orderCount })}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
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
