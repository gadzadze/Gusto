import { Store } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProductCard } from "@/components/buyer/product-card";
import { toProductViews } from "@/components/buyer/product-view";
import { BuyerHome } from "@/components/dashboard/buyer-home";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireBuyer } from "@/server/auth/guards";
import { listConnectedSuppliers, listTopOrderedProducts } from "@/server/domain/buyer/catalog";
import { lastOrderDates, listBuyerOrders, listOpenBuyerOrders } from "@/server/domain/orders/queries";
import { listRegularOrders } from "@/server/domain/orders/regular";

export default async function BuyerDashboardPage() {
  const t = await getTranslations("buyer");
  return (
    <>
      <PageHeader title={t("dashboardTitle")} />
      <Dashboard />
    </>
  );
}

async function Dashboard() {
  const ctx = await requireBuyer();
  const t = await getTranslations("buyer");
  const td = await getTranslations("buyer.dashboard");
  const [suppliers, recent, open, top, regular, lastOrders] = await Promise.all([
    listConnectedSuppliers(ctx),
    listBuyerOrders(ctx, 1, 5),
    listOpenBuyerOrders(ctx),
    listTopOrderedProducts(ctx, 10),
    listRegularOrders(ctx),
    lastOrderDates(ctx),
  ]);
  if (suppliers.length === 0 && recent.items.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title={t("emptyTitle")}
        body={t("emptyBody")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/buyer/suppliers">{t("emptyFind")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/buyer/suppliers/invite">{t("emptyInvite")}</Link>
            </Button>
          </div>
        }
      />
    );
  }
  const topViews = await Promise.all(
    top.map(async (entry) => {
      const [view] = await toProductViews([entry.product], entry.supplier, new Map([[entry.product.id, entry.cartQtyMilli]]));
      return { view, entry };
    }),
  );
  const topSection =
    topViews.length > 0 ? (
      <section className="space-y-3" aria-labelledby="top-products">
        <div>
          <h2 id="top-products" className="text-sm font-semibold">{td("topTitle")}</h2>
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
    ) : null;
  return (
    <BuyerHome
      suppliers={suppliers}
      recent={recent.items}
      open={open}
      regular={regular}
      lastOrders={Object.fromEntries(lastOrders)}
      topSection={topSection}
      now={new Date()}
    />
  );
}
