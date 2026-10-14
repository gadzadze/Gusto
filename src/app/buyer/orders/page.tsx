import { ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Pagination } from "@/components/app-shell/pagination";
import { PageHeader } from "@/components/app-shell/page-header";
import { OrderList } from "@/components/orders/order-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireBuyer } from "@/server/auth/guards";
import { listBuyerOrders } from "@/server/domain/orders/queries";

export default async function BuyerOrdersPage({ searchParams }: PageProps<"/buyer/orders">) {
  const t = await getTranslations("orders");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Orders searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Orders({ searchParams }: Pick<PageProps<"/buyer/orders">, "searchParams">) {
  const ctx = await requireBuyer();
  const t = await getTranslations("orders");
  const { page: raw } = await searchParams;
  const page = Number.parseInt(typeof raw === "string" ? raw : "1", 10) || 1;
  const list = await listBuyerOrders(ctx, page);
  if (list.items.length === 0) return <EmptyState icon={ClipboardList} title={t("emptyTitle")} body={t("emptyBuyer")} />;
  return (
    <>
      <OrderList orders={list.items} viewer="buyer" />
      <Pagination basePath="/buyer/orders" params={{}} page={list.page} pageCount={list.pageCount} />
    </>
  );
}
