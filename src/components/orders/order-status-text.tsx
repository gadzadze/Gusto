import { getTranslations } from "next-intl/server";
import type { OrderStatus } from "@/server/db/schema";
import { cn } from "@/lib/utils";

const DOT: Record<OrderStatus, string> = {
  pending: "bg-amber-500",
  confirmed: "bg-blue-500",
  delivered: "bg-green-600",
  rejected: "bg-muted-foreground",
  cancelled: "bg-muted-foreground",
};

/** The calm version of the status badge for lists: a small dot and the word, no coloured pill. */
export async function OrderStatusText({ status, className }: { status: OrderStatus; className?: string }) {
  const t = await getTranslations("orderStatus");
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", DOT[status])} />
      {t(status)}
    </span>
  );
}
