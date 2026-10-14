import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { OrderView } from "@/components/orders/order-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { availableActions } from "@/lib/orders/transitions";
import { milliToInput } from "@/lib/quantity";
import { requireSupplier } from "@/server/auth/guards";
import { NotFoundError } from "@/server/domain/errors";
import { getOrder } from "@/server/domain/orders/queries";
import { SupplierOrderActions } from "./order-actions";

export default async function SupplierOrderPage(props: PageProps<"/supplier/orders/[id]">) {
  const t = await getTranslations("orders");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground print:hidden">
        <Link href="/supplier/orders">
          <ArrowLeft />
          {t("title")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-3xl" />}>
        <Order {...props} />
      </Suspense>
    </>
  );
}

async function Order({ params }: PageProps<"/supplier/orders/[id]">) {
  const ctx = await requireSupplier();
  const tu = await getTranslations("units");
  const { id } = await params;
  const detail = await getOrder(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const actions = ctx.orgStatus === "suspended" ? [] : availableActions(detail.order.status, "supplier");
  return (
    <div className="max-w-3xl space-y-6">
      <OrderView detail={detail} viewer="supplier" />
      <div className="border-t border-border pt-6">
        <SupplierOrderActions
          orderId={detail.order.id}
          actions={actions}
          lines={detail.items.map((i) => ({
            itemId: i.id,
            name: i.name,
            orderedQty: milliToInput(i.orderedQtyMilli, ","),
            unit: tu(i.unit),
          }))}
        />
      </div>
    </div>
  );
}
