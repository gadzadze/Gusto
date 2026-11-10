import { ArrowLeft, Ban, PackageSearch } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { CustomerStatusBadge } from "@/components/customers/customer-status-badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhone } from "@/lib/phone";
import { requireSupplier } from "@/server/auth/guards";
import { getCustomer } from "@/server/domain/customers/customers";
import { getCustomerInsights } from "@/server/domain/customers/insights";
import { NotFoundError } from "@/server/domain/errors";
import { listPriceLists } from "@/server/domain/pricing/price-lists";
import { listTermsRequests } from "@/server/domain/pricing/conditions";
import { isPaymentMethod } from "@/lib/pricing/conditions";
import { CustomerControls } from "./customer-controls";
import { CustomerTerms } from "./customer-terms";
import { CustomerNote } from "./customer-note";
import { getFormats } from "@/server/i18n/formats";

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
  const fmt = await getFormats();
  const ctx = await requireSupplier();
  const t = await getTranslations("customers");
  const format = await getFormatter();
  const { id } = await params;
  const [customer, lists, insights, requests] = await Promise.all([
    getCustomer(ctx, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listPriceLists(ctx),
    getCustomerInsights(ctx, id),
    listTermsRequests(ctx),
  ]);
  const request = requests.find((r) => r.buyerOrgId === customer.buyerOrgId) ?? null;


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
      {customer.status === "active" || customer.status === "invited" ? (
        customer.priceListId ? (
          <p className="text-sm">
            <Link href={`/supplier/pricing/${customer.priceListId}`} className="font-medium text-brand underline-offset-2 hover:underline">
              {t("detail.editAssortment", { name: customer.priceListName ?? "" })}
            </Link>
          </p>
        ) : (
          <Notice icon={PackageSearch} title={t("detail.noListTitle")} tone="amber">{t("detail.noListBody")}</Notice>
        )
      ) : null}

      {customer.status === "active" && customer.buyerOrgId && customer.priceListId ? (
        <CustomerTerms
          buyerOrgId={customer.buyerOrgId}
          buyerName={customer.businessName}
          current={{ method: isPaymentMethod(customer.termsMethod) ? customer.termsMethod : null, intervalDays: customer.termsIntervalDays }}
          readOnly={ctx.orgStatus === "suspended"}
          request={
            request
              ? {
                  id: request.id,
                  method: request.method,
                  intervalDays: request.intervalDays,
                  fromBp: request.fromBp,
                  toBp: request.toBp,
                  samples: request.samples.map((s) => ({ name: s.name, now: fmt.money(s.nowMinor, request.currency), after: fmt.money(s.afterMinor, request.currency) })),
                }
              : null
          }
        />
      ) : null}

      {insights.orderCount > 0 ? (
        <section className="space-y-4 border-t border-border pt-6">
          <h2 className="font-semibold">{t("detail.history")}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t("detail.orders")} value={insights.orderCount} note={insights.lastOrderAt ? t("detail.lastOrder", { date: format.dateTime(insights.lastOrderAt, { dateStyle: "medium" }) }) : undefined} />
            <StatTile
              label={t("detail.orderValue")}
              value={fmt.money(insights.valueMinor, insights.currency ?? "GEL")}
              hint={t("detail.orderValueHint")}
            />
            <StatTile label={t("detail.firstOrder")} value={insights.firstOrderAt ? format.dateTime(insights.firstOrderAt, { dateStyle: "medium" }) : "-"} />
          </div>
          {insights.topProducts.length > 0 ? (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">{t("detail.topProducts")}</h3>
              <ul className="text-sm">
                {insights.topProducts.map((p) => (
                  <li key={p.name} className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
                    <span>{p.name}</span>
                    <span className="text-muted-foreground">{t("detail.inOrders", { count: p.orderCount })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-muted-foreground">{t("detail.recentOrders")}</h3>
            <ul className="text-sm">
              {insights.recent.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0">
                  <Link href={`/supplier/orders/${o.id}`} className="font-medium tabular-nums hover:underline">GST-{o.number}</Link>
                  <span className="text-muted-foreground">{format.dateTime(o.createdAt, { dateStyle: "medium" })}</span>
                  <span className="tabular-nums">{fmt.money(o.totalMinor, insights.currency ?? "GEL")}</span>
                  <OrderStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="border-t border-border pt-6">
        <CustomerNote customerId={customer.id} initial={customer.privateNote ?? ""} disabled={ctx.orgStatus === "suspended"} />
      </section>
    </div>
  );
}
