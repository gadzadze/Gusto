import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { OrderView } from "@/components/orders/order-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/auth/guards";
import { viewOrderForAdmin } from "@/server/domain/admin/orders";
import { NotFoundError } from "@/server/domain/errors";

export default async function AdminOrderPage(props: PageProps<"/admin/orders/[number]">) {
  const t = await getTranslations("admin.orders");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/admin/orders">
          <ArrowLeft />
          {t("back")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-3xl" />}>
        <Order {...props} />
      </Suspense>
    </>
  );
}

async function Order({ params }: PageProps<"/admin/orders/[number]">) {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin.orders");
  const { number } = await params;
  if (!/^\d{1,12}$/.test(number)) notFound();
  const detail = await viewOrderForAdmin(ctx, Number.parseInt(number, 10)).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  return (
    <div className="max-w-3xl space-y-4">
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{t("readOnly")}</p>
      <OrderView detail={detail} viewer="supplier" />
    </div>
  );
}
