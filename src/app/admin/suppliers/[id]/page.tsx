import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { SupplierStatusBadge } from "@/components/admin/supplier-status-badge";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import { requireAdmin } from "@/server/auth/guards";
import { VerificationCard } from "@/components/admin/verification-card";
import { getVerificationInfo } from "@/server/domain/admin/organizations";
import { getSupplierForAdmin } from "@/server/domain/admin/suppliers";
import { NotFoundError } from "@/server/domain/errors";
import { ReviewPanel } from "@/components/admin/review-panel";
import { reviewSupplierAction } from "../actions";

export default async function AdminSupplierPage(props: PageProps<"/admin/suppliers/[id]">) {
  const t = await getTranslations("admin");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/admin/suppliers">
          <ArrowLeft />
          {t("suppliersTitle")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Supplier {...props} />
      </Suspense>
    </>
  );
}

// Audit action names contain dots, which next-intl reads as nesting, so they
// map to flat message keys here.
const HISTORY_KEYS = {
  "organization.created": "organizationCreated",
  "supplier.approve": "supplierApprove",
  "supplier.suspend": "supplierSuspend",
  "supplier.reactivate": "supplierReactivate",
} as const;

async function Supplier({ params }: PageProps<"/admin/suppliers/[id]">) {
  const ctx = await requireAdmin();
  const t = await getTranslations("admin");
  const ts = await getTranslations("settings");
  const format = await getFormatter();
  const { id } = await params;
  const detail = await getSupplierForAdmin(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { org, settings, owners, productCounts, history } = detail;
  const info = await getVerificationInfo(ctx, org.id);
  const none = t("detail.none");

  const rows: [string, string][] = [
    [t("detail.legalId"), org.legalId ?? none],
    [t("detail.city"), org.city],
    [t("detail.deliveryArea"), settings?.deliveryArea ?? none],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={org.name} actions={<SupplierStatusBadge status={org.status} />} />
      <p className="-mt-4 text-sm text-muted-foreground">
        {t("detail.registered", { date: format.dateTime(org.createdAt, { dateStyle: "medium" }) })} ·{" "}
        {t("detail.products", productCounts)}
      </p>

      <ReviewPanel orgId={org.id} status={org.status} review={reviewSupplierAction} />
      <VerificationCard info={info} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.business")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              {settings ? (
                <div>
                  <dt className="text-muted-foreground">{ts("minOrder")}</dt>
                  <dd className="tabular-nums">{formatMoney(settings.minOrderMinor, org.currency)}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.contact")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{org.contactName}</dt>
                <dd className="tabular-nums">{org.phone}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("detail.owners")}</dt>
                <dd>
                  {owners.map((o, i) => (
                    <span key={i} className="block">
                      {[o.fullName, o.phone].filter(Boolean).join(" · ") || none}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("detail.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            {history.map((h, i) => (
              <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                <span className="w-40 shrink-0 text-muted-foreground">
                  {format.dateTime(h.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </span>
                <span>
                  {h.action in HISTORY_KEYS
                    ? t(`historyActions.${HISTORY_KEYS[h.action as keyof typeof HISTORY_KEYS]}`)
                    : h.action}
                  {typeof h.data?.reason === "string" ? (
                    <span className="text-muted-foreground"> - {h.data.reason}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
