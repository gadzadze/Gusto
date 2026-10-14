import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { CustomerStatusBadge } from "@/components/customers/customer-status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatPhone } from "@/lib/phone";
import { requireSupplier } from "@/server/auth/guards";
import { listCustomers } from "@/server/domain/customers/customers";

export default async function CustomersPage() {
  const t = await getTranslations("customers");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Customers />
      </Suspense>
    </>
  );
}

async function Customers() {
  const ctx = await requireSupplier();
  const t = await getTranslations("customers");
  const format = await getFormatter();
  const customers = await listCustomers(ctx);
  const canInvite = ctx.orgStatus === "active";

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
      {ctx.orgStatus === "pending_review" ? <Notice icon={Users} tone="amber" title={t("notActive")} /> : null}
      {canInvite ? (
        <Button asChild>
          <Link href="/supplier/customers/new">
            <Plus />
            {t("add")}
          </Link>
        </Button>
      ) : null}

      {customers.length === 0 ? (
        <EmptyState icon={Users} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t("columns.customer")}</TH>
              <TH>{t("columns.status")}</TH>
              <TH className="hidden sm:table-cell">{t("columns.priceList")}</TH>
              <TH className="hidden md:table-cell">{t("columns.contact")}</TH>
            </TR>
          </THead>
          <TBody>
            {customers.map((c) => (
              <TR key={c.id} className="hover:bg-muted/50">
                <TD>
                  <Link href={`/supplier/customers/${c.id}`} className="font-medium hover:underline">
                    {c.businessName}
                  </Link>
                  {c.buyerOrgName && c.buyerOrgName !== c.businessName ? (
                    <span className="block text-xs text-muted-foreground">{c.buyerOrgName}</span>
                  ) : null}
                  {c.status === "invited" ? (
                    <span className="block text-xs text-muted-foreground">
                      {c.inviteExpiresAt
                        ? t("inviteExpires", { date: format.dateTime(c.inviteExpiresAt, { dateStyle: "medium" }) })
                        : t("inviteNone")}
                    </span>
                  ) : null}
                </TD>
                <TD><CustomerStatusBadge status={c.status} /></TD>
                <TD className="hidden text-muted-foreground sm:table-cell">{c.priceListName ?? t("basePrices")}</TD>
                <TD className="hidden text-muted-foreground md:table-cell">
                  {[c.contactName, c.contactPhone && formatPhone(c.contactPhone)].filter(Boolean).join(" · ")}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
