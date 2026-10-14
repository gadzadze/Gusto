import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BuyerCancelButton, ReorderButton } from "@/components/orders/order-buttons";
import { OrderView } from "@/components/orders/order-view";
import { WhatsappShare } from "@/components/orders/whatsapp-share";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { availableActions } from "@/lib/orders/transitions";
import { requireBuyer } from "@/server/auth/guards";
import { NotFoundError } from "@/server/domain/errors";
import { getOrder } from "@/server/domain/orders/queries";

export default async function BuyerOrderPage(props: PageProps<"/buyer/orders/[id]">) {
  const t = await getTranslations("orders");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/buyer/orders">
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

async function Order({ params, searchParams }: PageProps<"/buyer/orders/[id]">) {
  const ctx = await requireBuyer();
  const t = await getTranslations("orders");
  const { id } = await params;
  const query = await searchParams;
  const detail = await getOrder(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const actions = availableActions(detail.order.status, "buyer");
  return (
    <div className="max-w-3xl space-y-6">
      {query.placed ? (
        <FormAlert tone="success">
          {t("placed")}. {t("placedBody", { supplier: detail.order.supplierName })}
        </FormAlert>
      ) : null}
      <OrderView detail={detail} viewer="buyer" />
      {detail.order.status === "pending" ? <WhatsappShare detail={detail} kind="to_supplier" /> : null}
      <div className="flex flex-wrap items-start gap-3 border-t border-border pt-6">
        <ReorderButton orderId={id} />
        {actions.includes("buyer_cancel") ? <BuyerCancelButton orderId={id} /> : null}
      </div>
    </div>
  );
}
