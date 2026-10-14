import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { formatMoney } from "@/lib/money";
import type { OrderListItem } from "@/server/domain/orders/queries";

export async function OrderList({ orders, viewer }: { orders: OrderListItem[]; viewer: "buyer" | "supplier" }) {
  const t = await getTranslations("orders");
  const format = await getFormatter();
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/${viewer}/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">{t("number", { number: o.number })}</span>
                <OrderStatusBadge status={o.status} />
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {viewer === "supplier" ? o.buyerName : o.supplierName} ·{" "}
                {format.dateTime(o.createdAt, { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </span>
            <span className="whitespace-nowrap text-sm font-medium tabular-nums">{formatMoney(o.totalMinor, o.currency)}</span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
