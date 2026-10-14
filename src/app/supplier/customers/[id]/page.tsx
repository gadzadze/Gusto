import { ArrowLeft, Ban } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { CustomerStatusBadge } from "@/components/customers/customer-status-badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhone } from "@/lib/phone";
import { requireSupplier } from "@/server/auth/guards";
import { getCustomer } from "@/server/domain/customers/customers";
import { NotFoundError } from "@/server/domain/errors";
import { listPriceLists } from "@/server/domain/pricing/price-lists";
import { CustomerControls } from "./customer-controls";

export default async function CustomerPage(props: PageProps<"/supplier/customers/[id]">) {
  const t = await getTranslations("customers");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/supplier/customers">
          <ArrowLeft />
          {t("title")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-80 w-full max-w-3xl" />}>
        <Customer {...props} />
      </Suspense>
    </>
  );
}

async function Customer({ params }: PageProps<"/supplier/customers/[id]">) {
  const ctx = await requireSupplier();
  const t = await getTranslations("customers");
  const format = await getFormatter();
  const { id } = await params;
  const [customer, lists] = await Promise.all([
    getCustomer(ctx, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listPriceLists(ctx),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={customer.businessName} actions={<CustomerStatusBadge status={customer.status} />} />
      <dl className="-mt-3 space-y-1 text-sm text-muted-foreground">
        {customer.buyerOrgName ? <div>{t("detail.connectedAs", { name: customer.buyerOrgName })}</div> : null}
        {customer.connectedAt ? (
          <div>{t("detail.connectedAt", { date: format.dateTime(customer.connectedAt, { dateStyle: "medium" }) })}</div>
        ) : null}
        <div>{[customer.contactName, customer.contactPhone && formatPhone(customer.contactPhone), customer.contactEmail].filter(Boolean).join(" · ")}</div>
        {customer.status === "invited" ? (
          <div>
            {customer.inviteExpiresAt
              ? t("inviteExpires", { date: format.dateTime(customer.inviteExpiresAt, { dateStyle: "medium" }) })
              : t("inviteNone")}
          </div>
        ) : null}
      </dl>
      {customer.status === "blocked" ? <Notice icon={Ban} title={t("detail.blockedNote")} /> : null}
      <CustomerControls
        customerId={customer.id}
        status={customer.status}
        priceListId={customer.priceListId}
        priceLists={lists.map((l) => ({ id: l.id, name: l.name }))}
        hasOpenInvite={Boolean(customer.inviteExpiresAt)}
        canInvite={ctx.orgStatus === "active"}
        readOnly={ctx.orgStatus === "suspended"}
      />
    </div>
  );
}
