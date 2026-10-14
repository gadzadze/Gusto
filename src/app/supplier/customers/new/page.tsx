import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireSupplier } from "@/server/auth/guards";
import { listPriceLists } from "@/server/domain/pricing/price-lists";
import { CustomerForm } from "./customer-form";

export default async function NewCustomerPage() {
  const t = await getTranslations("customers");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/supplier/customers">
          <ArrowLeft />
          {t("title")}
        </Link>
      </Button>
      <PageHeader title={t("newTitle")} />
      <Suspense fallback={<Skeleton className="h-80 w-full max-w-2xl" />}>
        <NewCustomer />
      </Suspense>
    </>
  );
}

async function NewCustomer() {
  const ctx = await requireSupplier();
  // Only approved suppliers invite; the domain enforces it too.
  if (ctx.orgStatus !== "active") notFound();
  const lists = await listPriceLists(ctx);
  return (
    <CustomerForm
      priceLists={lists.map((l) => ({ id: l.id, name: l.name }))}
      defaultPriceListId={lists.find((l) => l.isDefault)?.id ?? ""}
    />
  );
}
