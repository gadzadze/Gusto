import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Pagination } from "@/components/app-shell/pagination";
import { PageHeader } from "@/components/app-shell/page-header";
import { OrderList } from "@/components/orders/order-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { requireSupplier } from "@/server/auth/guards";
import { countSupplierOrders, listSupplierOrders, SUPPLIER_TABS, type SupplierTab } from "@/server/domain/orders/queries";

export default async function SupplierOrdersPage({ searchParams }: PageProps<"/supplier/orders">) {
  const t = await getTranslations("orders");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Inbox({ searchParams }: Pick<PageProps<"/supplier/orders">, "searchParams">) {
  const ctx = await requireSupplier();
  const t = await getTranslations("orders");
  const params = await searchParams;
  const tab: SupplierTab = params.tab === "confirmed" || params.tab === "done" ? params.tab : "new";
  const page = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1;
  const [list, counts] = await Promise.all([listSupplierOrders(ctx, tab, page), countSupplierOrders(ctx)]);
  const total = counts.new + counts.confirmed + counts.done;

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
        {(Object.keys(SUPPLIER_TABS) as SupplierTab[]).map((key) => (
          <Link
            key={key}
            href={key === "new" ? "/supplier/orders" : `/supplier/orders?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 md:min-h-9 items-center gap-2 rounded-full border px-3 text-sm",
              tab === key ? "border-brand bg-brand-soft text-brand" : "border-border hover:bg-muted",
            )}
          >
            {t(`tabs.${key}`)}
            <span className="tabular-nums text-muted-foreground">{counts[key]}</span>
          </Link>
        ))}
      </nav>
      {list.items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={total === 0 ? t("emptyTitle") : t("emptyTab")} body={total === 0 ? t("emptySupplier") : undefined} />
      ) : (
        <>
          <OrderList orders={list.items} viewer="supplier" />
          <Pagination basePath="/supplier/orders" params={{ tab: tab === "new" ? undefined : tab }} page={list.page} pageCount={list.pageCount} />
        </>
      )}
    </div>
  );
}
